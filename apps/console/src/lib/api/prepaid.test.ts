import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  startPrepaidCheckout,
  reconcilePrepaidOperations,
  type PrepaidPurchase,
} from "./prepaid"
const api = vi.hoisted(() => vi.fn())
vi.mock("./client", () => ({ apiClient: (...args: unknown[]) => api(...args) }))
const route = "https://console.test/plan-usage/buy-credit/"
const body = (index: number) => JSON.parse(api.mock.calls[index]![1].body)
beforeEach(() => {
  api.mockReset()
  sessionStorage.clear()
})
const respond = (state = "pending", url?: string) =>
  api.mockImplementation((_path, options) => ({
    purchase_id: JSON.parse(options.body).operation_id,
    state,
    ...(url ? { url } : {}),
  }))
describe("Starter durable checkout", () => {
  it("replays original identity, amount and frozen redirect URLs after response loss", async () => {
    api.mockRejectedValueOnce(new Error("lost response"))
    await expect(
      startPrepaidCheckout("use:team", 500, route, "actor"),
    ).rejects.toThrow("lost response")
    const first = body(0)
    respond("pending", "https://checkout.stripe.com/original")
    const result = await startPrepaidCheckout(
      "use:team",
      500,
      route + "?purchase=cancel",
      "actor",
    )
    expect(body(1)).toEqual(first)
    expect(result.url).toBe("https://checkout.stripe.com/original")
    const success = new URL(first.success_url)
    expect(success.searchParams.get("team")).toBe("use:team")
    expect(success.searchParams.get("purchase_id")).toBe(first.operation_id)
    expect(new URL(first.cancel_url).searchParams.get("purchase")).toBe(
      "cancel",
    )
  })
  it("keeps pending or paid operations until authoritative terminal history", async () => {
    respond("pending")
    await startPrepaidCheckout("use:team", 500, route, "actor")
    const id = body(0).operation_id
    respond("paid")
    await startPrepaidCheckout("use:team", 500, route, "actor")
    expect(body(1).operation_id).toBe(id)
    reconcilePrepaidOperations("actor", "use:team", [
      { id, state: "paid" },
    ] as PrepaidPurchase[])
    await startPrepaidCheckout("use:team", 500, route, "actor")
    expect(body(2).operation_id).toBe(id)
    reconcilePrepaidOperations("actor", "use:team", [
      { id, state: "credited" },
    ] as PrepaidPurchase[])
    await startPrepaidCheckout("use:team", 500, route, "actor")
    expect(body(3).operation_id).not.toBe(id)
  })
  it("isolates actors, teams and deliberately different amounts", async () => {
    respond()
    await startPrepaidCheckout("use:team", 500, route, "actor")
    await startPrepaidCheckout("use:other", 500, route, "actor")
    await startPrepaidCheckout("use:team", 500, route, "another")
    await startPrepaidCheckout("use:team", 1000, route, "actor")
    expect(
      new Set(api.mock.calls.map((_, i) => body(i).operation_id)).size,
    ).toBe(4)
    reconcilePrepaidOperations("actor", "use:other", [
      { id: body(0).operation_id, state: "credited" },
    ] as PrepaidPurchase[])
    await startPrepaidCheckout("use:team", 500, route, "actor")
    expect(body(4).operation_id).toBe(body(0).operation_id)
  })
  it("doesn't discard operation identity on mismatched response or unsafe redirect", async () => {
    api.mockResolvedValue({ purchase_id: "different", state: "credited" })
    await expect(
      startPrepaidCheckout("use:team", 500, route, "actor"),
    ).rejects.toThrow("uncertain")
    const id = body(0).operation_id
    respond("pending", "https://checkout.stripe.com.evil.test/s")
    await expect(
      startPrepaidCheckout("use:team", 500, route, "actor"),
    ).rejects.toThrow("Unable to open payment")
    expect(body(1).operation_id).toBe(id)
  })
  it("replays a closed-entry recovery with frozen URLs and never creates a replacement", async () => {
    api.mockRejectedValueOnce(new Error("lost response"))
    await expect(
      startPrepaidCheckout("use:team", 500, route, "actor"),
    ).rejects.toThrow()
    const original = body(0)
    respond("pending", "https://checkout.stripe.com/original")
    await startPrepaidCheckout(
      "use:team",
      500,
      route + "?changed=true",
      "actor",
      original.operation_id,
    )
    expect(body(1)).toEqual(original)
    sessionStorage.clear()
    await expect(
      startPrepaidCheckout(
        "use:team",
        500,
        route,
        "actor",
        original.operation_id,
      ),
    ).rejects.toThrow("already finished")
    expect(api).toHaveBeenCalledTimes(2)
    expect(sessionStorage.length).toBe(0)
  })
  it("rotates identity only after a terminal backend result", async () => {
    respond("credited")
    await startPrepaidCheckout("use:team", 500, route, "actor")
    await startPrepaidCheckout("use:team", 500, route, "actor")
    expect(body(1).operation_id).not.toBe(body(0).operation_id)
  })
})
