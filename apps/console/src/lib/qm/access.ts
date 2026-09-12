import type { User } from "@supabase/supabase-js"

import { isStaff } from "@/lib/admin/staff"

/**
 * QM Cloud beta gate. `NEXT_PUBLIC_QM_BETA_TEAMS` is a comma-separated list
 * of team ids allowed into the beta, or `*` to open it to every team. Staff
 * always pass so the section can be dogfooded before any team is enrolled.
 * Unset (the default) hides the section entirely — nav item and routes.
 */
export interface QmBetaAllowlist {
  everyone: boolean
  teamIds: ReadonlySet<string>
}

export function parseQmBetaAllowlist(raw: string | undefined): QmBetaAllowlist {
  const entries = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    everyone: entries.includes("*"),
    teamIds: new Set(entries.filter((e) => e !== "*")),
  }
}

/** Read at call time (not module load) so tests can stub the env. The name
 * must stay a literal for Next.js to inline it into client bundles. */
export function qmBetaAllowlist(): QmBetaAllowlist {
  return parseQmBetaAllowlist(process.env.NEXT_PUBLIC_QM_BETA_TEAMS)
}

export function canAccessQm(
  user: User | null | undefined,
  teamId: string | null | undefined,
  allowlist: QmBetaAllowlist = qmBetaAllowlist(),
): boolean {
  if (isStaff(user)) return true
  if (allowlist.everyone) return true
  return !!teamId && allowlist.teamIds.has(teamId)
}
