import { renderHook } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import type { PrepaidPurchase } from "@/lib/api/prepaid"

import { useRetainedPrepaidOperations } from "./use-prepaid-credit"

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
