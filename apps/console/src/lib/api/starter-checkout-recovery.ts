import { z } from "zod"

import { apiClient } from "./client"
import { isStripeCheckoutUrl } from "./plan-checkout"

const identity = z.object({
  purchase_id: z.string().uuid(),
  checkout_generation: z.string().datetime({ offset: true }),
  amount_cents: z.number().int().positive(),
})
export type PendingStarterCheckout = z.infer<typeof identity>
const responseSchema = z.discriminatedUnion("outcome", [
  identity.extend({ outcome: z.literal("pending_starter_checkout") }),
  identity.extend({
    outcome: z.literal("recovered"),
    url: z.string().refine(isStripeCheckoutUrl),
  }),
  z.object({
    outcome: z.literal("retryable"),
    purchase_id: z.string().uuid(),
    checkout_generation: z.string().datetime({ offset: true }),
  }),
  z.object({ outcome: z.literal("payment_confirmation_pending") }),
  z.object({ outcome: z.literal("no_pending_starter_checkout") }),
])

export async function recoverStarterCheckout(
  team: string,
  operation?: PendingStarterCheckout,
  cancel = false,
) {
  const response = responseSchema.parse(
    await apiClient<unknown>("/billing/prepaid/checkout/recover", {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({
        expected_team: team,
        ...(operation
          ? {
              purchase_id: operation.purchase_id,
              checkout_generation: operation.checkout_generation,
              cancel,
            }
          : {}),
      }),
    }),
  )
  if (
    !operation &&
    ![
      "pending_starter_checkout",
      "no_pending_starter_checkout",
      "payment_confirmation_pending",
    ].includes(response.outcome)
  )
    throw new Error(
      "Unable to identify your original credit purchase. Check its status again.",
    )
  if (
    operation &&
    (response.outcome === "recovered" || response.outcome === "retryable") &&
    (response.purchase_id !== operation.purchase_id ||
      response.checkout_generation !== operation.checkout_generation ||
      (response.outcome === "recovered" &&
        (cancel || response.amount_cents !== operation.amount_cents)))
  )
    throw new Error("The credit purchase changed. Check its status again.")
  if (
    operation &&
    response.outcome !== "recovered" &&
    response.outcome !== "retryable" &&
    response.outcome !== "payment_confirmation_pending"
  )
    throw new Error(
      "Unable to confirm the original credit purchase. Check its status again.",
    )
  return response
}
