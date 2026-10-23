import "server-only"
import * as z from "zod"

import { adminBillingRequest } from "@/lib/admin/billing-api"
import type { ProvisionedTeam } from "@/lib/api/team-provisioning"
import { DEFAULT_REGION } from "@/lib/cells"

const catalogSchema = z.object({
  plans: z.array(
    z.object({
      id: z.string(),
      display_name: z.string(),
      state: z.string(),
      self_serve: z.boolean(),
      monthly_fee_cents: z.number().nullable(),
      annual_fee_cents: z.number().nullable(),
    }),
  ),
})

export interface EnterprisePlanVersion {
  id: string
  name: string
}

/** Published, staff-assigned versions without a fee: the plans an Enterprise team can be given. */
export async function listEnterprisePlanVersions(
  region: string = DEFAULT_REGION,
): Promise<EnterprisePlanVersion[]> {
  const catalog = await adminBillingRequest({
    region,
    path: "/internal/billing/catalog",
    schema: catalogSchema,
  })
  return catalog.plans
    .filter(
      (plan) =>
        plan.state === "published" &&
        !plan.self_serve &&
        !plan.monthly_fee_cents &&
        !plan.annual_fee_cents,
    )
    .map((plan) => ({ id: plan.id, name: plan.display_name }))
}

/**
 * Moves an approved applicant's new team onto its Enterprise plan. The key is
 * per applicant, so a retried approval replays the same assignment.
 */
export async function assignEnterprisePlan(
  team: ProvisionedTeam,
  applicantId: string,
  versionId: string,
): Promise<void> {
  await adminBillingRequest({
    region: team.region,
    path: `/internal/teams/${team.id}/billing/plan-assignments`,
    method: "POST",
    body: {
      idempotency_key: `enterprise-approval:${applicantId}`,
      version_id: versionId,
      reason: "Enterprise signup approved",
    },
    schema: z.object({ id: z.string() }),
  })
}
