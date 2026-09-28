"use server"

import type { User } from "@supabase/supabase-js"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { canReadPlatformSandboxes } from "@/lib/admin/permissions"
import { resolveActiveTeam } from "@/lib/api/active-team"
import type { TeamMembership } from "@/lib/api/team-directory"
import type { SnapshotStatus, TeamSnapshot } from "@/lib/api/types"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

async function getTeam(user: User): Promise<TeamMembership | null> {
  const impersonation = await getImpersonationContext(user)
  if (impersonation) {
    if (!canReadPlatformSandboxes(user)) {
      throw new Error(
        "Forbidden: platform sandbox read access required while viewing another team",
      )
    }
    return { teamId: impersonation.teamId, region: impersonation.region }
  }

  return resolveActiveTeam(user.id).catch(() => null)
}

export async function listSnapshotsAction(): Promise<TeamSnapshot[]> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const team = await getTeam(user)
  if (!team) return []

  const admin = cellFor(team.region).createAdminClient()
  const { data, error } = await admin
    .from("sandbox_snapshot")
    .select(
      "id, sandbox_id, template_id, status, name, size_bytes, vcpu_count, memory_mib, disk_mib, created_at, ready_at",
    )
    .eq("team_id", team.teamId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  const rows = data ?? []

  // Names of source sandboxes that still exist; a deleted one shows by id.
  const sandboxIds = [...new Set(rows.map((s) => s.sandbox_id as string))]
  const names = new Map<string, string>()
  if (sandboxIds.length > 0) {
    const { data: sandboxes, error: sandboxError } = await admin
      .from("sandbox")
      .select("id, name")
      .eq("team_id", team.teamId)
      .is("destroyed_at", null)
      .in("id", sandboxIds)
    if (sandboxError) throw new Error(sandboxError.message)
    for (const sb of sandboxes ?? []) {
      names.set(sb.id as string, sb.name as string)
    }
  }

  return rows.map((s) => ({
    id: s.id as string,
    sandbox_id: s.sandbox_id as string,
    sandbox_name: names.get(s.sandbox_id as string) ?? null,
    template_id: (s.template_id as string | null) ?? null,
    kind: "mem+fs",
    status: s.status as SnapshotStatus,
    name: (s.name as string | null) ?? null,
    size_bytes: Number(s.size_bytes),
    resources: {
      vcpu_count: s.vcpu_count as number,
      memory_mib: s.memory_mib as number,
      disk_mib: s.disk_mib as number,
    },
    created_at: s.created_at as string,
    ready_at: (s.ready_at as string | null) ?? null,
  }))
}
