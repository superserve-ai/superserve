import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  recoverProPayment,
  startProCheckout,
  resumeProCheckout,
} from "./plan-checkout"

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

it("replays an accepted checkout after lost response with frozen team, actor, offer and URLs", async () => {
  api.mockRejectedValueOnce(new Error("lost response"))
  await expect(
    startProCheckout(
      "use:team",
      "pro_monthly",
      "https://console.test/billing/pro?team=use%3Ateam&return=%2Foriginal",
      "actor",
    ),
  ).rejects.toThrow("lost response")
  const original = JSON.parse(api.mock.calls[0][1].body)
  api.mockResolvedValue({ url: "https://checkout.stripe.com/original" })
  await expect(resumeProCheckout("use:team", "actor")).resolves.toBe(
    "https://checkout.stripe.com/original",
  )
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual(original)
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/billing/pro?team=use%3Ateam&return=%2Fchanged",
    "actor",
  )
  expect(JSON.parse(api.mock.calls[2][1].body)).toEqual(original)
})
it("does not create a fresh operation while checking a closed-entry or different-account recovery", async () => {
  await expect(resumeProCheckout("use:team", "actor")).resolves.toBeNull()
  expect(api).not.toHaveBeenCalled()
  api.mockResolvedValue({ outcome: "payment_confirmation_pending" })
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/billing/pro?team=use%3Ateam",
    "actor",
  )
  await expect(resumeProCheckout("use:team", "other-actor")).resolves.toBeNull()
  await expect(resumeProCheckout("use:other", "actor")).resolves.toBeNull()
  expect(api).toHaveBeenCalledTimes(1)
})

it("preserves accepted replay context after a provider transient and after no-URL pending responses", async () => {
  api.mockResolvedValueOnce({ outcome: "payment_confirmation_pending" })
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/billing/pro?team=use%3Ateam",
    "actor",
  )
  const original = JSON.parse(api.mock.calls[0][1].body)
  api.mockRejectedValueOnce(new Error("provider unavailable"))
  await expect(resumeProCheckout("use:team", "actor")).rejects.toThrow(
    "provider unavailable",
  )
  api.mockResolvedValueOnce({ outcome: "payment_confirmation_pending" })
  await expect(resumeProCheckout("use:team", "actor")).resolves.toBeNull()
  api.mockResolvedValueOnce({ url: "https://checkout.stripe.com/original" })
  await expect(resumeProCheckout("use:team", "actor")).resolves.toBe(
    "https://checkout.stripe.com/original",
  )
  for (const call of api.mock.calls)
    expect(JSON.parse(call[1].body)).toEqual(original)
})

it("isolates checkout after account switching and preserves each actor's frozen replay", async () => {
  api.mockRejectedValueOnce(new Error("lost response"))
  await expect(
    startProCheckout(
      "use:team",
      "pro_monthly",
      "https://console.test/actor-a",
      "actor-a",
    ),
  ).rejects.toThrow("lost response")
  const first = JSON.parse(api.mock.calls[0][1].body)
  api.mockResolvedValue({ outcome: "payment_confirmation_pending" })
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/actor-b",
    "actor-b",
  )
  const second = JSON.parse(api.mock.calls[1][1].body)
  expect(second.operation_id).not.toBe(first.operation_id)
  expect(second.success_url).toContain("/actor-b")
  await resumeProCheckout("use:team", "actor-a")
  expect(JSON.parse(api.mock.calls[2][1].body)).toEqual(first)
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/changed",
    "actor-b",
  )
  expect(JSON.parse(api.mock.calls[3][1].body)).toEqual(second)
})

it("keeps a legacy accepted checkout exclusive to its original actor without rotating its identity", async () => {
  const legacyKey = "pro-checkout:use:team:pro_monthly"
  const context = {
    id: "accepted-operation",
    actor: "actor-a",
    team: "use:team",
    offer: "pro_monthly",
    success: "https://console.test/original?billing=success",
    cancel: "https://console.test/original?billing=cancel",
  }
  sessionStorage.setItem(legacyKey, context.id)
  sessionStorage.setItem(`${legacyKey}:context`, JSON.stringify(context))
  api.mockResolvedValue({ outcome: "payment_confirmation_pending" })
  await expect(resumeProCheckout("use:team", "actor-b")).resolves.toBeNull()
  expect(api).not.toHaveBeenCalled()
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/actor-b",
    "actor-b",
  )
  expect(JSON.parse(api.mock.calls[0][1].body).operation_id).not.toBe(
    context.id,
  )
  await resumeProCheckout("use:team", "actor-a")
  const replay = JSON.parse(api.mock.calls[1][1].body)
  expect(replay.operation_id).toBe(context.id)
  expect(replay.success_url).toBe(context.success)
  await startProCheckout(
    "use:team",
    "pro_monthly",
    "https://console.test/changed",
    "actor-a",
  )
  expect(JSON.parse(api.mock.calls[2][1].body)).toEqual(replay)
  expect(sessionStorage.getItem(legacyKey)).toBe(context.id)
})

it("does not mint an operation when a legacy checkout has ambiguous ownership", async () => {
  sessionStorage.setItem(
    "pro-checkout:use:team:pro_monthly",
    "accepted-operation",
  )
  await expect(
    startProCheckout(
      "use:team",
      "pro_monthly",
      "https://console.test/billing",
      "actor",
    ),
  ).rejects.toThrow("cannot be identified")
  expect(api).not.toHaveBeenCalled()
  expect(sessionStorage.length).toBe(1)
})
