import { beforeEach, describe, expect, it, vi } from "vitest"

let user: { id: string } | null
const start = vi.fn()
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
  }),
}))
vi.mock("@/lib/api/signup-checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/signup-checkout")>()),
  startSignupCheckout: (...args: unknown[]) => start(...args),
}))

import { GET } from "./route"

const visit = async (query: string) =>
  new URL(
    (
      await GET(
        new Request(
          `https://console.example.test/api/onboarding/checkout/?${query}`,
        ),
      )
    ).headers.get("location")!,
  )

describe("signup checkout resume", () => {
  beforeEach(() => {
    user = { id: "u1" }
    start.mockReset()
  })

  it("resumes the selected plan's checkout for a team waiting for payment", async () => {
    start.mockResolvedValue("https://checkout.stripe.com/c/pay/cs_test_1")
    expect((await visit("offer=developer")).href).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_1",
    )
    expect(start).toHaveBeenCalledWith(
      user,
      "developer",
      "https://console.example.test",
    )
  })

  it("sends a team that already has a plan to the console", async () => {
    start.mockResolvedValue(null)
    expect((await visit("offer=pro_monthly")).pathname).toBe("/sandboxes")
  })

  it("keeps the offer on a retry page when checkout cannot start", async () => {
    start.mockRejectedValue(new Error("cell down"))
    const location = await visit("offer=developer")
    expect(location.searchParams.get("reason")).toBe("checkout_unavailable")
    expect(location.searchParams.get("offer")).toBe("developer")
  })

  it("asks for sign-in and returns to the same checkout", async () => {
    user = null
    const location = await visit("offer=pro_monthly")
    expect(location.pathname).toBe("/auth/signin")
    expect(location.searchParams.get("next")).toBe(
      "/api/onboarding/checkout/?offer=pro_monthly",
    )
    expect(start).not.toHaveBeenCalled()
  })

  it("rejects an unknown offer without starting checkout", async () => {
    expect((await visit("offer=enterprise")).searchParams.get("reason")).toBe(
      "plan_required",
    )
    expect(start).not.toHaveBeenCalled()
  })
})
