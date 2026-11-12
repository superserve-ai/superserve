import { beforeEach, expect, it, vi } from "vitest"

const returned = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("./pro-payment", () => ({ ProPayment: () => null }))
vi.mock("@/lib/posthog/checkout", () => ({
  recordCheckoutReturnForUser: returned,
}))

import ProPaymentPage from "./page"

const visit = (query: Record<string, string | string[]>) =>
  ProPaymentPage({ searchParams: Promise.resolve(query) })

beforeEach(() => returned.mockClear())

it.each(["success", "cancel"] as const)(
  "records a %s return from Checkout for the pinned team",
  async (billing) => {
    await visit({ billing, team: "use:team-1" })
    expect(returned).toHaveBeenCalledWith({
      surface: "billing_pro",
      outcome: billing,
      teamKey: "use:team-1",
    })
  },
)

it("records nothing for a visit that isn't a Checkout return", async () => {
  await visit({ team: "use:team-1" })
  await visit({ billing: "success" })
  await visit({ billing: ["success", "cancel"], team: "use:team-1" })
  expect(returned).not.toHaveBeenCalled()
})
