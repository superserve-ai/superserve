import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"

import {
  type ImpersonationDisplayContext,
  getImpersonationTeamId,
  impersonationTtlMs,
} from "@/lib/admin/impersonation"
import { ensureImpersonationKeyRow } from "@/lib/admin/impersonation-key"
import { platformImpersonationReadScopes } from "@/lib/admin/permissions"
import {
  pickActiveTeam,
  readTeamSelection,
  serializeTeamSelection,
} from "@/lib/api/active-team"
import { publishPromotionIdentity } from "@/lib/api/promotion-identity"
import { getProxySecret, hashKey } from "@/lib/api/proxy-secret"
import {
  invalidateMembershipDirectory,
  listTeamMembershipsForUser,
  listTeamMembershipsForUserDetailed,
  findTeamById,
  type TeamMembership,
} from "@/lib/api/team-directory"
import { provisionTeam } from "@/lib/api/team-provisioning"
import { classifyGoogleMembershipState } from "@/lib/auth/google-onboarding"
import { isGoogleUser } from "@/lib/auth/google-signup-proof"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export { getProxySecret, hashKey } from "@/lib/api/proxy-secret"

const PROXY_KEY_NAME = "__console_proxy__"
// Bump this when you want to force-rotate every proxy key. v2 added the team
// id to the derivation (one key per user per team, so switching teams swaps
// keys instead of re-pointing one row); v1 rows are inert leftovers.
const PROXY_KEY_VERSION = "v2"

/**
 * @internal — exported for tests. Deterministic per-user-per-team key
 * derivation. The team id is part of the MAC input so each of a user's teams
 * gets its own key row in its own cell, and the injected key always
 * authorizes exactly the active team.
 */
export function deriveRawKey(userId: string, teamId: string): string {
  const mac = crypto
    .createHmac("sha256", getProxySecret())
    .update(`${PROXY_KEY_VERSION}:${userId}:${teamId}`)
    .digest()
  return `ss_live_${mac.toString("base64url")}`
}

// Authorization state is cached with a short TTL, never indefinitely: a
// user removed from a team (or moved between cells) must lose proxy access
// within a bounded window, not at the next process recycle. The TTL bounds
// staleness to one minute; every entry costs one membership read per user
// per minute to refresh, which is noise.
const AUTHZ_CACHE_TTL_MS = 60_000

interface Expiring<T> {
  value: T
  expires: number
}

function getFresh<T>(map: Map<string, Expiring<T>>, key: string): T | null {
  const entry = map.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    map.delete(key)
    return null
  }
  return entry.value
}

function setFresh<T>(map: Map<string, Expiring<T>>, key: string, value: T) {
  map.set(key, { value, expires: Date.now() + AUTHZ_CACHE_TTL_MS })
}

// user:team pairs whose api_key row was ensured recently — re-ensuring is
// one idempotent upsert, so the TTL also heals a server-side key-row
// deletion.
const ensuredKeys = new Map<string, Expiring<true>>()
// The user's active team + home cell, keyed by user AND selection so a team
// switch takes effect immediately instead of after the TTL.
const teamCache = new Map<string, Expiring<TeamMembership>>()

async function getTeamForUser(
  user: User,
  observedAt?: string,
): Promise<TeamMembership> {
  const userId = user.id
  const email = user.email ?? user.id
  const googleUser = isGoogleUser(user)
  const selection = await readTeamSelection()
  const cacheKey = `${userId}|${selection ? serializeTeamSelection(selection) : ""}`
  const cached = getFresh(teamCache, cacheKey)
  if (cached) return cached

  let detailedLookup: {
    memberships: TeamMembership[]
    degradedRegions: string[]
  } | null = null
  let memberships = await listTeamMembershipsForUser(userId)
  if (googleUser && memberships.length === 0) {
    // A fresh, complete directory read is required before deciding this is a
    // first-team Google onboarding attempt. If that read is degraded, a
    // verified onboarding marker can recover the current membership, but the
    // marker itself never counts as membership.
    detailedLookup = await listTeamMembershipsForUserDetailed(userId, {
      maxAgeMs: 0,
    })
    memberships = detailedLookup.memberships
    const state = await classifyGoogleMembershipState(userId, detailedLookup)
    if (state.kind === "existing") {
      const activeMembership =
        pickActiveTeam(detailedLookup.memberships, selection) ??
        state.membership
      setFresh(teamCache, cacheKey, activeMembership)
      return activeMembership
    } else if (state.kind === "indeterminate") {
      console.warn("Google onboarding blocked: membership lookup degraded", {
        userId,
        degradedRegions: state.degradedRegions,
        stage: "proxy-auth",
      })
      throw new Error("Google membership lookup degraded; please try again")
    }
  }
  const membership = pickActiveTeam(memberships, selection)
  if (membership) {
    setFresh(teamCache, cacheKey, membership)
    return membership
  }

  // First login: no membership yet. Provision a team through the same full
  // RBAC chain the create-team action uses — a legacy-only team (team +
  // team_member, no team_memberships/role assignment) is one the console
  // lists but the control plane 403s, so the user's first request fails.
  const team = await provisionTeam(
    DEFAULT_REGION,
    userId,
    email,
    email,
    observedAt ? { user, observedAt } : undefined,
  )

  // The empty membership list we just read may be cached; drop it so other
  // surfaces (billing, quota, directory) see the new team immediately.
  invalidateMembershipDirectory(userId)

  const created = { teamId: team.id, region: DEFAULT_REGION }
  setFresh(teamCache, cacheKey, created)
  return created
}

export async function getTeamIdForUser(
  user: User,
  observedAt?: string,
): Promise<string> {
  const { teamId } = await getTeamForUser(user, observedAt)
  return teamId
}

/**
 * Home region of the user's active team. Billing publication and upstream
 * requests must target the same cell as the proxy key row.
 */
export async function getRegionForUser(user: User): Promise<string> {
  const { region } = await getTeamForUser(user)
  return region
}

/**
 * Ensure the derived proxy key's hash exists in the api_key table of the
 * team's home cell. Idempotent: does an INSERT ... ON CONFLICT (key_hash)
 * DO NOTHING, so concurrent callers across multiple instances cannot stomp
 * each other.
 */
async function ensureProxyKeyRow(
  user: User,
  team: TeamMembership,
  keyHash: string,
  observedAt?: string,
): Promise<void> {
  const userId = user.id
  const ensureKey = `${userId}|${team.region}:${team.teamId}`
  if (getFresh(ensuredKeys, ensureKey)) return

  const admin = cellFor(team.region).createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from("profile")
    .select("id")
    .eq("id", userId)
    .maybeSingle()
  if (profileError) throw new Error("Failed to read regional profile")
  if (!profile) {
    if (!observedAt) {
      throw new Error(
        "Authenticated user observation unavailable; please retry",
      )
    }
    await publishPromotionIdentity(team.region, userId, user, observedAt)
  }
  const { error } = await admin.from("api_key").upsert(
    {
      team_id: team.teamId,
      key_hash: keyHash,
      name: PROXY_KEY_NAME,
      scopes: [],
      created_by: userId,
    },
    { onConflict: "key_hash", ignoreDuplicates: true },
  )

  if (error) throw new Error(`Failed to ensure proxy key: ${error.message}`)

  setFresh(ensuredKeys, ensureKey, true)
}

export async function getAuthApiKeyForUser(
  user: User | null,
  impersonatedTarget?:
    | string
    | Pick<ImpersonationDisplayContext, "teamId" | "region">
    | null,
  observedAt?: string,
): Promise<string | null> {
  if (!user) return null

  let teamId: string | null
  let region: string | null = null

  if (impersonatedTarget === undefined) {
    teamId = await getImpersonationTeamId(user)
  } else if (typeof impersonatedTarget === "string") {
    teamId = impersonatedTarget
  } else if (impersonatedTarget) {
    teamId = impersonatedTarget.teamId
    region = impersonatedTarget.region
  } else {
    teamId = null
  }

  if (teamId) {
    const scopes = platformImpersonationReadScopes(user)
    if (scopes.length === 0) {
      throw new Error(
        "Forbidden: impersonation requires a supported platform read permission",
      )
    }

    const targetRegion =
      region ?? (await findTeamById(teamId))?.region ?? DEFAULT_REGION

    return ensureImpersonationKeyRow(
      user.id,
      teamId,
      targetRegion,
      scopes,
      Math.floor(impersonationTtlMs() / 60_000),
    )
  }

  return (await getAuthApiKeyAndTeamForUser(user, observedAt)).apiKey
}

/** Keep the key and its resolved team together for a single proxy request. */
export async function getAuthApiKeyAndTeamForUser(
  user: User,
  observedAt?: string,
): Promise<{ apiKey: string; team: TeamMembership }> {
  const team = await getTeamForUser(user, observedAt)
  const apiKey = await ensureAuthApiKeyForTeam(user, team, observedAt)
  return { apiKey, team }
}

/** Repair only the key for a team already resolved by this request. */
export async function ensureAuthApiKeyForTeam(
  user: User,
  team: TeamMembership,
  observedAt?: string,
): Promise<string> {
  const apiKey = deriveRawKey(user.id, team.teamId)
  await ensureProxyKeyRow(user, team, hashKey(apiKey), observedAt)
  return apiKey
}

/** Resolve an existing Checkout's key and cell without a profile write. */
export async function getAuthApiKeyAndTeamForRecovery(
  user: User,
  observedAt?: string,
): Promise<{ apiKey: string; team: TeamMembership }> {
  const team = await getTeamForUser(user, observedAt)
  return { apiKey: deriveRawKey(user.id, team.teamId), team }
}

/**
 * Authenticate the current request and return the API key to inject.
 * Returns null if the user is not authenticated.
 */
export async function getAuthApiKey(): Promise<string | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return getAuthApiKeyForUser(user, undefined, new Date().toISOString())
}

export async function getApiBaseUrlForUser(user: User): Promise<string> {
  return cellFor(await getRegionForUser(user)).apiBaseUrl
}
