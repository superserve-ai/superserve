import { beforeEach, describe, expect, it, vi } from "vitest"

import { recoverProPayment, startProCheckout } from "./plan-checkout"

const api = vi.hoisted(() => vi.fn())
vi.mock("./client", () => ({ apiClient: (...args: unknown[]) => api(...args) }))

beforeEach(() => api.mockReset())

describe("Pro upgrade recovery", () => {
  it("keeps an accepted asynchronous checkout pending", async () => {
    api.mockResolvedValue({ outcome: "payment_confirmation_pending" })
    await expect(
      startProCheckout(
        "use:team",
        "pro_monthly",
        "https://console.test/billing/pro/?team=use%3Ateam",
      ),
    ).resolves.toBeNull()
  })

  it("returns a Stripe card setup URL after a full promotion", async () => {
    api.mockResolvedValue({
      outcome: "payment_method_required",
      url: "https://checkout.stripe.com/setup",
    })
    await expect(recoverProPayment("use:team")).resolves.toBe(
      "https://checkout.stripe.com/setup",
    )
  })

  it("rejects an untrusted card setup destination", async () => {
    api.mockResolvedValue({
      outcome: "payment_method_required",
      url: "https://checkout.stripe.com.example.test/setup",
    })
    await expect(recoverProPayment("use:team")).rejects.toThrow(
      "Payment status is unavailable",
    )
  })
})
