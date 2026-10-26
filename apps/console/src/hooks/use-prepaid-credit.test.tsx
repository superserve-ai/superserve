import { act, renderHook } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { startPrepaidCheckout, type PrepaidPurchase } from "@/lib/api/prepaid"

import { useRetainedPrepaidOperations } from "./use-prepaid-credit"

const api = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/client", () => ({
  apiClient: (...args: unknown[]) => api(...args),
}))
const state = vi.hoisted(() => ({ actor: "actor", team: "use:team" }))
vi.mock("./use-user", () => ({
  useUser: () => ({ user: { id: state.actor } }),
}))
vi.mock("./use-billing-context", () => ({
  useBillingContext: () => ({ teamKey: state.team }),
}))
const id = "aa6097b8-8424-42d3-b47b-f87dc912a7be"
const key = "starter-checkout:actor:use:team:500"
beforeEach(() => {
  api.mockReset()
  sessionStorage.clear()
  state.actor = "actor"
  state.team = "use:team"
  sessionStorage.setItem(
    key,
    JSON.stringify({
      id,
      actor: "actor",
      team: "use:team",
      amount: 500,
      success: "frozen-success",
      cancel: "frozen-cancel",
    }),
  )
})
it("recovers the same actor and team's retained purchase without backend history", () => {
  const { result, rerender } = renderHook(() => useRetainedPrepaidOperations())
  expect(result.current).toMatchObject([
    { id, amount: 500, success: "frozen-success", cancel: "frozen-cancel" },
  ])
  state.team = "use:other"
  rerender()
  expect(result.current).toEqual([])
  state.team = "use:team"
  state.actor = "other-actor"
  rerender()
  expect(result.current).toEqual([])
  expect(sessionStorage.getItem(key)).not.toBeNull()
})
it("removes recovery only when this team's authoritative history is terminal", () => {
  const { result, rerender } = renderHook(
    ({ purchases }) => useRetainedPrepaidOperations(purchases),
    {
      initialProps: { purchases: [{ id, state: "paid" }] as PrepaidPurchase[] },
    },
  )
  expect(result.current).toHaveLength(1)
  rerender({ purchases: [{ id, state: "credited" }] as PrepaidPurchase[] })
  expect(result.current).toEqual([])
  expect(sessionStorage.getItem(key)).toBeNull()
})

it("updates an initially empty snapshot when checkout saves an intent without changing actor, team or purchases", async () => {
  sessionStorage.clear()
  const purchases: PrepaidPurchase[] = []
  const { result, rerender } = renderHook(
    ({ entry }) => ({
      operations: useRetainedPrepaidOperations(purchases),
      entry,
    }),
    { initialProps: { entry: "v2" } },
  )
  expect(result.current.operations).toEqual([])
  api.mockRejectedValueOnce(new Error("lost response"))
  await act(async () => {
    await expect(
      startPrepaidCheckout(
        "use:team",
        500,
        "https://console.test/plan-usage/buy-credit",
        "actor",
      ),
    ).rejects.toThrow("lost response")
  })
  rerender({ entry: "legacy" })
  expect(result.current.operations).toHaveLength(1)
  expect(result.current.operations[0]).toMatchObject({
    actor: "actor",
    team: "use:team",
    amount: 500,
  })
  const retained = result.current.operations[0]!
  api.mockResolvedValueOnce({ purchase_id: retained.id, state: "credited" })
  await act(async () => {
    await startPrepaidCheckout(
      "use:team",
      500,
      "https://console.test/plan-usage/buy-credit",
      "actor",
      retained.id,
    )
  })
  expect(result.current.operations).toEqual([])
})
