import type { ActivityResponse } from "@/lib/api/types"
import { roleLabel } from "@/lib/team/roles"

// Plain words for activity actions the server records as codes. The server
// writes "<cause>_paused" for an automatic pause; billing_ineligible means the
// team had no trial credit or plan left at that time.
export const BILLING_PAUSE_ACTIVITY = "billing_ineligible_paused"

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  [BILLING_PAUSE_ACTIVITY]: "Paused: trial credit used up or no plan",
  team_invitation_created: "Invitation created",
  team_invitation_resent: "Invitation resent",
  team_invitation_revoked: "Invitation revoked",
  team_invitation_accepted: "Invitation accepted",
  team_member_left: "Member left",
  team_renamed: "Team renamed",
  team_role_assigned: "Role assigned",
  team_role_revoked: "Role revoked",
  team_member_removed: "Member removed",
}

export function activityActionLabel(action: string): string {
  return Object.hasOwn(ACTIVITY_ACTION_LABELS, action)
    ? ACTIVITY_ACTION_LABELS[action]!
    : action
}

export function activityResource(log: ActivityResponse): string {
  if (log.category !== "team") {
    return log.sandbox_name ?? log.secret_name ?? "-"
  }
  const metadata = log.metadata ?? {}
  const target = [
    metadata.email,
    metadata.target_user_id,
    metadata.user_id,
    metadata.team_name,
    metadata.new_name,
  ].find((value) => typeof value === "string" && value.length > 0)
  const role =
    typeof metadata.role_name === "string"
      ? roleLabel(metadata.role_name)
      : undefined
  return [target ?? "Team", role].filter(Boolean).join(" · ")
}
