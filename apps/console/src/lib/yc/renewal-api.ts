import "server-only"
import {
  AcceptanceError,
  readOfferStatus,
  resolveAcceptedClaim,
} from "./acceptance-api"
import { postYCAccount } from "./customer-request"
import {
  renewalInputSchema,
  renewalSchema,
  type RenewalInput,
} from "./renewal-schema"

export function renewalEnabled() {
  return process.env.YC_CONSOLE_RENEWAL_ENABLED === "true"
}

async function send(
  operation: "status" | "submit",
  locator: string,
  fields?: Record<string, unknown>,
) {
  if (!renewalEnabled()) throw new AcceptanceError("unavailable")
  const { user, claim } = await resolveAcceptedClaim(locator)
  const acceptance = await readOfferStatus(locator)
  if (!acceptance.accepted_at || !acceptance.assignment_id)
    throw new AcceptanceError("unavailable")
  if (
    fields &&
    (fields.assignment_id !== acceptance.assignment_id ||
      fields.acceptance_id !== acceptance.acceptance_id ||
      fields.expected_approval_revision !== acceptance.approval_revision)
  )
    throw new AcceptanceError("conflict")
  const result = renewalSchema.parse(
    await postYCAccount(user.id, claim.home_region!, "renewals", operation, {
      ...fields,
      team_id: claim.team_id,
      assignment_id: acceptance.assignment_id,
    }),
  )
  if (
    result.acceptance_id !== acceptance.acceptance_id ||
    result.assignment_id !== acceptance.assignment_id ||
    result.approval_revision !== acceptance.approval_revision ||
    (fields && result.intended_boundary !== fields.intended_boundary)
  )
    throw new AcceptanceError("conflict")
  return result
}
export async function readRenewal(claim: string) {
  return send("status", claim)
}
export async function submitRenewal(input: RenewalInput) {
  const { claim_id, ...fields } = renewalInputSchema.parse(input)
  return send("submit", claim_id, fields)
}
