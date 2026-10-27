import { expect, it, vi } from "vitest"

import ProPaymentPage from "./page"
vi.mock("./pro-payment", () => ({ ProPayment: () => null }))
it("normalizes conflicting server query values without crashing before client callback validation", async () => {
  const page = await ProPaymentPage({
    searchParams: Promise.resolve({
      billing: ["success", "cancel"],
      return: ["/sandboxes/", "//external.test"],
      team: ["use:one", "use:two"],
    }),
  })
  expect(page.props.billingReturn).toBeUndefined()
  expect(page.props.checkoutTeam).toBeUndefined()
  expect(page.props.returnTo).toBe("/plan-usage/")
})
