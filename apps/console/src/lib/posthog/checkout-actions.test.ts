import { beforeEach, expect, it, vi } from "vitest"

const returned = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("./checkout", () => ({ recordCheckoutReturnForUser: returned }))

import { recordPlanPickerCancelAction } from "./checkout-actions"

beforeEach(() => returned.mockClear())

it("records a cancelled picker Checkout with the catalog offer", async () => {
  await recordPlanPickerCancelAction({
    account: "u1",
    team: "use:team-1",
    offer: "starter",
  })
  expect(returned).toHaveBeenCalledWith({
    surface: "plan_picker",
    outcome: "cancel",
    account: "u1",
    teamKey: "use:team-1",
    offer: "developer_monthly",
  })
})

it("drops an offer the picker doesn't sell and ignores a malformed call", async () => {
  await recordPlanPickerCancelAction({
    account: "u1",
    team: "use:team-1",
    offer: "enterprise",
  })
  expect(returned).toHaveBeenLastCalledWith(
    expect.objectContaining({ offer: null }),
  )
  await recordPlanPickerCancelAction(null as never)
  expect(returned).toHaveBeenCalledOnce()
})
