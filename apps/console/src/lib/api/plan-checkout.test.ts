import { beforeEach, describe, expect, it, vi } from "vitest"

import { recoverProPayment, startProCheckout } from "./plan-checkout"

const api = vi.hoisted(() => vi.fn())
vi.mock("./client", () => ({ apiClient: (...args: unknown[]) => api(...args) }))

beforeEach(() => {
  api.mockReset()
  sessionStorage.clear()
})

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

it("reuses operation identity across response loss and rotates after terminal recovery", async () => {
  api.mockRejectedValueOnce(new Error("lost response"))
  await expect(
    startProCheckout(
      "use:team",
      "pro_monthly",
      "https://console.test/billing/pro",
    ),
  ).rejects.toThrow("lost response")
  const first = JSON.parse(api.mock.calls[0][1].body).operation_id
  api.mockResolvedValue({ outcome: "payment_confirmation_pending" })
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/billing/pro",
  )
  expect(JSON.parse(api.mock.calls[1][1].body).operation_id).toBe(first)
  api.mockResolvedValue({ outcome: "retryable" })
  await recoverProPayment("use:team")
  api.mockResolvedValue({ outcome: "payment_confirmation_pending" })
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/billing/pro",
  )
  expect(JSON.parse(api.mock.calls[3][1].body).operation_id).not.toBe(first)
})

it("preserves checkout identity created after recovery starts", async () => {
  let finishRecovery!: (value: { outcome: string }) => void
  api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRecovery = resolve
      }),
  )
  const recovery = recoverProPayment("use:team")
  api.mockResolvedValue({ outcome: "payment_confirmation_pending" })
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/billing/pro",
  )
  const operation = JSON.parse(api.mock.calls[1][1].body).operation_id
  finishRecovery({ outcome: "no_pending_pro_purchase" })
  await recovery
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/billing/pro",
  )
  expect(JSON.parse(api.mock.calls[2][1].body).operation_id).toBe(operation)
})

it("clears only the completed offer identity", async () => {
  sessionStorage.setItem("pro-checkout:use:team:pro_annual", "other-operation")
  api.mockResolvedValue({ outcome: "active" })
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/billing/pro",
  )
  expect(sessionStorage.getItem("pro-checkout:use:team:pro_annual")).toBe(
    "other-operation",
  )
  expect(sessionStorage.getItem("pro-checkout:use:team:pro_monthly")).toBeNull()
})
