import "server-only"
import { AdminBillingRequestError } from "@/lib/admin/billing-api"
import type { ProvisionedTeam } from "@/lib/api/team-provisioning"

/** Moves a newly provisioned team onto its Enterprise plan. */
export async function assignEnterprisePlan(
  _team: ProvisionedTeam,
): Promise<void> {
  throw new AdminBillingRequestError("unavailable")
}
