import { beforeEach, expect, it, vi } from "vitest"

import { recoverStarterCheckout } from "./starter-checkout-recovery"
const api = vi.hoisted(() => vi.fn())
vi.mock("./client", () => ({ apiClient: (...args: unknown[]) => api(...args) }))
const purchase = {
  purchase_id: "11111111-1111-4111-8111-111111111111",
  checkout_generation: "2026-10-26T12:00:00.123456789Z",
  amount_cents: 2500,
}
beforeEach(() => {
  api.mockReset()
})
it("discovers without resuming, creating or cancelling a purchase", async () => {
  api.mockResolvedValue({ ...purchase, outcome: "pending_starter_checkout" })
  await expect(recoverStarterCheckout("use:team")).resolves.toMatchObject(
    purchase,
  )
  expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({
    expected_team: "use:team",
  })
})
it.each([false, true])(
  "binds explicit operation and cancel=%s to the exact discovered generation",
  async (cancel) => {
    api.mockResolvedValue(
      cancel
        ? { ...purchase, outcome: "retryable" }
        : {
            ...purchase,
            outcome: "recovered",
            url: "https://checkout.stripe.com/original",
          },
    )
    await recoverStarterCheckout("use:team", purchase, cancel)
    expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({
      expected_team: "use:team",
      purchase_id: purchase.purchase_id,
      checkout_generation: purchase.checkout_generation,
      cancel,
    })
  },
)
it.each([
  { outcome: "recovered", ...purchase, url: "https://evil.test" },
  {
    outcome: "recovered",
    ...purchase,
    amount_cents: 500,
    url: "https://checkout.stripe.com/other",
  },
  {
    outcome: "retryable",
    ...purchase,
    checkout_generation: "2026-10-26T12:00:01Z",
  },
  { outcome: "no_pending_starter_checkout" },
])("rejects changed/untrusted explicit response %o", async (response) => {
  api.mockResolvedValue(response)
  await expect(recoverStarterCheckout("use:team", purchase)).rejects.toThrow()
})
it("does not treat old backend or denied discovery as no pending purchase", async () => {
  api.mockRejectedValue(new Error("404"))
  await expect(recoverStarterCheckout("use:team")).rejects.toThrow("404")
})
it("never navigates a recovered response during discovery or explicit cancellation", async () => {
  api.mockResolvedValue({
    ...purchase,
    outcome: "recovered",
    url: "https://checkout.stripe.com/original",
  })
  await expect(recoverStarterCheckout("use:team")).rejects.toThrow()
  await expect(
    recoverStarterCheckout("use:team", purchase, true),
  ).rejects.toThrow()
})
it("keeps uncertain provider status pending", async () => {
  api.mockResolvedValue({ outcome: "payment_confirmation_pending" })
  await expect(
    recoverStarterCheckout("use:team", purchase, true),
  ).resolves.toEqual({ outcome: "payment_confirmation_pending" })
})
