import { z } from "zod"

export const financialAuthoritySchema = z
  .object({
    kind: z.literal("accepted_offer"),
    state: z.enum([
      "acceptance_pending",
      "valid",
      "revocation_pending",
      "revoked",
    ]),
    pending_invalidations: z.number().int().nonnegative().safe(),
  })
  .refine(
    (value) =>
      (value.state === "revocation_pending") ===
      value.pending_invalidations > 0,
    "Financial revocation state and outstanding acknowledgments disagree",
  )
  .nullable()
export type FinancialAuthority = z.infer<typeof financialAuthoritySchema>

export const financialRevocationMessages = {
  pending: {
    title: "Revocation pending",
    description:
      "New activation is blocked. We are confirming that previously authorized billing benefits have been stopped. This does not confirm cancellation or a refund.",
  },
  revoked: {
    title: "Revocation confirmed",
    description:
      "The offer’s billing authorization has been revoked. Existing usage and unpaid charges still apply. This does not confirm cancellation or a refund.",
  },
}

// Provider control_pending describes another operation. It cannot confirm
// whether all durable regional financial fences have acknowledged revocation.
export function financialRevocationMessage(
  authority: FinancialAuthority | undefined,
) {
  if (
    !authority ||
    !["revocation_pending", "revoked"].includes(authority.state)
  )
    return null
  return authority.state === "revocation_pending"
    ? financialRevocationMessages.pending
    : financialRevocationMessages.revoked
}
