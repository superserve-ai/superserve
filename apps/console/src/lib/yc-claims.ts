import "server-only"
import { cookies } from "next/headers"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import { listTeamMembershipsForUserDetailed } from "@/lib/api/team-directory"
import { completedMemberships } from "@/lib/api/team-provisioning"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

export const YC_COOKIE = "yc_claim_confirmation"
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export interface YCClaim {
  id: string
  state: string
  confirmation_status: string
  reason: string
  company_identity: string | null
  submitted_email: string
  team_id: string | null
  home_region: string | null
  approval_id: string | null
  evidence: { name: string; companies?: Array<{ name: string }> }
}

export function parseYCConfirmation(
  raw: string | undefined,
): { id: string; token: string } | null {
  if (!raw || raw.length > 100) return null
  const [id, token, extra] = raw.split(".")
  return !extra && UUID.test(id ?? "") && TOKEN.test(token ?? "")
    ? { id, token }
    : null
}

export class YCManualReviewError extends Error {}

export async function ycRequest<T>(
  operation: string,
  body: unknown,
  region = DEFAULT_REGION,
): Promise<T> {
  const token = process.env.YC_CLAIM_CONSOLE_TOKEN
  if (!token || token.length < 32)
    throw new Error("YC claim service unavailable. Please retry later.")
  const origin = new URL(cellFor(region).apiBaseUrl)
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("YC claim service unavailable. Please retry later.")
  const response = await fetch(
    new URL(`/internal/yc/account/${operation}`, origin),
    {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    },
  )
  if (response.status === 409 || response.status === 403)
    throw new YCManualReviewError(
      response.status === 409
        ? "This claim requires manual review. Contact the Superserve team."
        : "A team owner or administrator must complete this claim.",
    )
  if (!response.ok)
    throw new Error("YC claim service unavailable. Please retry later.")
  return response.json() as Promise<T>
}

export async function ycAccount() {
  const client = await createServerClient()
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (error || !user) return null
  if (!user.email || !user.email_confirmed_at || user.is_anonymous)
    throw new Error("Verify your account email before completing this claim.")
  if (await getImpersonationContext(user))
    throw new Error("YC claims cannot be changed during impersonation.")
  return user
}

export async function ycTeams(
  user: NonNullable<Awaited<ReturnType<typeof ycAccount>>>,
  allowProvision = false,
) {
  let directory = await completedMemberships(
    user.id,
    await listTeamMembershipsForUserDetailed(user.id, { maxAgeMs: 0 }),
  )
  if (directory.degradedRegions.length)
    throw new Error("Team lookup is incomplete. Please retry.")
  if (allowProvision && !directory.memberships.length) {
    // Normal signup policy and team creation still own the first account/team.
    await getAuthApiKeyAndTeamForUser(user, new Date().toISOString())
    directory = await completedMemberships(
      user.id,
      await listTeamMembershipsForUserDetailed(user.id, { maxAgeMs: 0 }),
    )
    if (directory.degradedRegions.length)
      throw new Error("Team lookup is incomplete. Please retry.")
  }
  const groups = new Map<string, string[]>()
  for (const membership of directory.memberships)
    groups.set(membership.region, [
      ...(groups.get(membership.region) ?? []),
      membership.teamId,
    ])
  const names = new Map<string, string>()
  await Promise.all(
    [...groups].map(async ([region, ids]) => {
      const { data, error } = await cellFor(region)
        .createAdminClient()
        .from("team")
        .select("id,name,home_region")
        .in("id", ids)
      if (error) throw new Error("Team lookup is incomplete. Please retry.")
      for (const team of data ?? [])
        if (team.home_region === region)
          names.set(`${region}:${team.id}`, team.name)
    }),
  )
  if (
    directory.memberships.some((t) => !names.has(`${t.region}:${t.teamId}`))
  ) {
    throw new YCManualReviewError(
      "Team home region requires manual review. Contact Superserve.",
    )
  }
  return directory.memberships.map((t) => ({
    teamId: t.teamId,
    region: t.region,
    name: names.get(`${t.region}:${t.teamId}`)!,
  }))
}

export async function ycProof() {
  return parseYCConfirmation((await cookies()).get(YC_COOKIE)?.value)
}
