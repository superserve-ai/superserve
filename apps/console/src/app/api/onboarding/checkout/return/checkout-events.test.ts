// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  settle: vi.fn(async (): Promise<string | null> => "/sandboxes"),
  returned: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: m.user } }) },
  }),
}))
vi.mock("@/lib/api/signup-checkout", () => ({
  settleSignupCheckout: m.settle,
}))
vi.mock("@/lib/posthog/checkout", () => ({
  recordCheckoutReturned: m.returned,
}))

import { GET } from "./route"

const visit = (account: string) =>
  GET(
    new Request(
      `https://console.example.test/api/onboarding/checkout/return/?account=${account}&team=use%3At1`,
    ),
  )

describe("checkout return events", () => {
  beforeEach(() => {
    m.user = { id: "u1" }
    m.returned.mockReset()
    m.settle.mockReset().mockResolvedValue("/sandboxes")
  })

  it("records a successful return for the team in the URL", async () => {
    await visit("u1")
    expect(m.returned).toHaveBeenCalledOnce()
    expect(m.returned).toHaveBeenCalledWith({
      userId: "u1",
      surface: "plan_picker",
      outcome: "success",
      teamKey: "use:t1",
    })
  })

  it("still records the return when settling fails", async () => {
    m.settle.mockRejectedValue(new Error("cell down"))
    const response = await visit("u1")
    expect(response.headers.get("location")).toContain("/onboarding/payment/")
    expect(m.returned).toHaveBeenCalledOnce()
  })

  it("records nothing for another account's return or a signed-out visit", async () => {
    await visit("someone-else")
    m.user = null
    await visit("u1")
    expect(m.returned).not.toHaveBeenCalled()
  })
})
