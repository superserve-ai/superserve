import "server-only"
import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"
import { after } from "next/server"

import { pickActiveTeam, readTeamSelection } from "@/lib/api/active-team"
import { publishPromotionIdentity } from "@/lib/api/promotion-identity"
import {
  invalidateMembershipDirectory,
  listTeamMembershipsForUserDetailed,
  type TeamMembership,
} from "@/lib/api/team-directory"
import {
  completedMemberships,
  provisionTeam,
} from "@/lib/api/team-provisioning"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { trackEvent } from "@/lib/posthog/actions"
import { API_KEY_EVENTS } from "@/lib/posthog/events"

// Region codes embedded in new API keys (ss_live_<region>_...). Must stay in
// sync with the team_home_region_valid CHECK constraint in the control-plane
// schema. The region segment lets the API edge route a request to the team's
// home cell from the key string alone — no directory lookup. Legacy keys
// without a region segment keep working: the control plane hashes the whole
// string, so the format is opaque to auth.
const REGION_CODES = new Set(["use", "usw"])

function generateRawKey(region: string): string {
  const bytes = crypto.randomBytes(24)
  return `ss_live_${region}_${bytes.toString("base64url")}`
}

/**
 * A team's home region determines which cell serves its API traffic; new keys
 * carry it as a routing hint. Falls back to the default region if the
 * home_region migration hasn't been applied yet or the value is unknown, so
 * key creation never breaks on schema skew.
 */
async function getTeamHomeRegion(team: TeamMembership): Promise<string> {
  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("team")
    .select("home_region")
    .eq("id", team.teamId)
    .single()
  // Fall back to the cell the team was discovered in, not DEFAULT_REGION:
  // a transient read failure for a usw team must not mint a use-prefixed
  // key that the edge would route to the wrong cell. team.region is always
  // a configured region, so it is a safe routing prefix.
  if (error || !data?.home_region || !REGION_CODES.has(data.home_region)) {
    return team.region
  }
  return data.home_region as string
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}

/**
 * The user's active team (their selection when it's a live membership,
 * otherwise the deterministic default). If no team exists at all,
 * auto-create one (named after their email) in the default cell and add
 * them as owner.
 */
/** The team a key action would use right now, without creating one. */
export async function findActiveTeamForUser(userId: string) {
  const directory = await completedMemberships(
    userId,
    await listTeamMembershipsForUserDetailed(userId, { maxAgeMs: 0 }),
  )
  return {
    active: pickActiveTeam(directory.memberships, await readTeamSelection()),
    degraded: directory.degradedRegions.length > 0,
  }
}

export async function getOrCreateTeamForUser(
  user: User,
  observedAt: string,
): Promise<TeamMembership> {
  const { active, degraded } = await findActiveTeamForUser(user.id)
  if (active) {
    return active
  }

  if (degraded) throw new Error("Membership lookup degraded; please try again")

  // No team yet — provision one through the full RBAC chain (same helper the
  // create-team and proxy-auth paths use), so a first API-key action can't
  // leave the user with a legacy-only team the control plane rejects.
  const email = user.email ?? user.id
  const team = await provisionTeam(DEFAULT_REGION, user.id, email, email, {
    user,
    observedAt,
  })
  invalidateMembershipDirectory(user.id)
  return { teamId: team.id, region: DEFAULT_REGION }
}

/**
 * Where a key was created, sent as the `source` property of the server-side
 * `api_key_created` event. The console values come from the browser, so the
 * server action checks them against this list.
 */
export const CONSOLE_API_KEY_SOURCES = [
  "create_dialog",
  "connect_dialog_sdk_key",
  "get_started",
] as const
export type ConsoleApiKeySource = (typeof CONSOLE_API_KEY_SOURCES)[number]
export type ApiKeySource = ConsoleApiKeySource | "console" | "cli_device_login"

export function consoleApiKeySource(value: unknown): ApiKeySource {
  return CONSOLE_API_KEY_SOURCES.includes(value as ConsoleApiKeySource)
    ? (value as ConsoleApiKeySource)
    : "console"
}

export async function mintTeamApiKey(
  user: User,
  team: TeamMembership,
  name: string,
  observedAt: string,
  source: ApiKeySource,
) {
  const region = await getTeamHomeRegion(team)
  const rawKey = generateRawKey(region)
  const keyHash = hashKey(rawKey)
  // ss_live_<region>_ plus the first 8 random chars, e.g. "ss_live_use_AbCdEfGh..."
  // Sliced relative to the region length so a future region code of a
  // different length still shows exactly 8 random chars.
  const keyPrefix = `${rawKey.slice(0, `ss_live_${region}_`.length + 8)}...`

  // The key row must live in the team's cell — that's the database the
  // team's control plane authenticates against. The creator's profile row
  // (created_by FK target) must exist in that same cell: today only
  // createTeamAction guarantees it, and a membership provisioned any other
  // way (seed, admin tooling, migration) would otherwise FK-violate here.
  const admin = cellFor(team.region).createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from("profile")
    .select("id")
    .eq("id", user.id)
    .maybeSingle()
  if (profileError) throw new Error("Failed to read regional profile")
  if (!profile) {
    await publishPromotionIdentity(team.region, user.id, user, observedAt)
  }
  const { data, error } = await admin
    .from("api_key")
    .insert({
      team_id: team.teamId,
      key_hash: keyHash,
      name,
      scopes: [],
      created_by: user.id,
    })
    .select("id, name, created_at")
    .single()

  if (error) throw new Error(error.message)

  // Analytics only, sent after the response: a slow or failing PostHog must
  // never delay or fail the key handoff (CLI device login has already used
  // its code by now). Never send the key or its hash.
  try {
    after(async () => {
      try {
        await trackEvent(API_KEY_EVENTS.CREATED, user.id, {
          source,
          api_key_id: data.id,
          team_id: team.teamId,
          team_region: team.region,
        })
      } catch {
        /* Delivery is best effort. */
      }
    })
  } catch {
    /* No request scope (for example a script): skip the event. */
  }

  return {
    id: data.id as string,
    name: data.name as string,
    key: rawKey,
    prefix: keyPrefix,
    created_at: data.created_at as string,
  }
}
