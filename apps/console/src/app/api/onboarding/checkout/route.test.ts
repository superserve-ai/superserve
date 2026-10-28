// @vitest-environment node

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

import { GET, POST } from "./route"

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
    expect(
      (await visit("offer=developer&account=u1&team=use%3Ateam-1")).href,
    ).toBe("https://checkout.stripe.com/c/pay/cs_test_1")
    expect(start).toHaveBeenCalledWith(
      user,
      "developer",
      "https://console.example.test",
      { account: "u1", team: "use:team-1" },
      false,
    )
  })

  it("sends a team that already has a plan to the console", async () => {
    start.mockResolvedValue(null)
    expect(
      (await visit("offer=pro_monthly&account=u1&team=use%3Ateam-1")).pathname,
    ).toBe("/sandboxes")
  })

  it("keeps the offer on a retry page when checkout cannot start", async () => {
    start.mockRejectedValue(new Error("cell down"))
    const location = await visit("offer=developer&account=u1&team=use%3Ateam-1")
    expect(location.searchParams.get("reason")).toBe("checkout_unavailable")
    expect(location.searchParams.get("offer")).toBe("developer")
  })

  it("asks for sign-in and returns to the plan picker so the choice is made again", async () => {
    user = null
    const location = await visit(
      "offer=pro_monthly&account=u1&team=use%3Ateam-1",
    )
    expect(location.pathname).toBe("/auth/signin")
    expect(location.searchParams.get("next")).toBe(
      "/auth/choose-plan/?reason=upgrade&offer=pro_monthly&account=u1&team=use%3Ateam-1",
    )
    expect(start).not.toHaveBeenCalled()
  })

  it("rejects an unknown offer without starting checkout", async () => {
    expect(
      (
        await visit("offer=enterprise&account=u1&team=use%3Ateam-1")
      ).searchParams.get("reason"),
    ).toBe("upgrade")
    expect(start).not.toHaveBeenCalled()
  })

  it("lets a same-origin plan choice replace an open checkout", async () => {
    start.mockResolvedValue("https://checkout.stripe.com/c/pay/cs_test_2")
    const response = await POST(
      new Request(
        "https://console.example.test/api/onboarding/checkout/?offer=pro_monthly&account=u1&team=use%3Ateam-1",
        { method: "POST", headers: { origin: "https://console.example.test" } },
      ),
    )
    expect(response.status).toBe(303)
    expect(start).toHaveBeenCalledWith(
      user,
      "pro_monthly",
      "https://console.example.test",
      { account: "u1", team: "use:team-1" },
      true,
    )
  })

  it("refuses a cross-site plan choice", async () => {
    const response = await POST(
      new Request(
        "https://console.example.test/api/onboarding/checkout/?offer=pro_monthly&account=u1&team=use%3Ateam-1",
        { method: "POST", headers: { origin: "https://other.example" } },
      ),
    )
    expect(response.status).toBe(403)
    expect(start).not.toHaveBeenCalled()
  })

  it.each([
    ["offer=pro_monthly&account=u1&team=use%3Ateam-1", null],
    ["offer=enterprise&account=u1&team=use%3Ateam-1", { id: "u1" }],
    ["offer=pro_monthly", { id: "u1" }],
  ])(
    "turns a plan choice into a page load on every redirect (%s)",
    async (query, signedIn) => {
      user = signedIn
      const response = await POST(
        new Request(
          `https://console.example.test/api/onboarding/checkout/?${query}`,
          {
            method: "POST",
            headers: { origin: "https://console.example.test" },
          },
        ),
      )
      expect(response.status).toBe(303)
      expect(start).not.toHaveBeenCalled()
    },
  )
})
