import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: async () => ({
    apiKey: "server-only",
    team: { teamId: "team-1", region: "use" },
  }),
}))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({ apiBaseUrl: "https://api.example.test" }),
}))

import type { User } from "@supabase/supabase-js"

import { startSignupCheckout } from "./signup-checkout"

const user = { id: "u1" } as User
const origin = "https://console.example.test"
let entryState: string
let checkout: { status: number; body: unknown }
const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith("/billing/plan"))
    return Response.json({ entry_state: entryState })
  return Response.json(checkout.body, { status: checkout.status })
})

describe("startSignupCheckout", () => {
  beforeEach(() => {
    entryState = "pending_payment"
    checkout = {
      status: 200,
      body: { url: "https://checkout.stripe.com/c/pay/cs_test_1" },
    }
    fetchMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("leaves a team that already has a plan on its existing destination", async () => {
    entryState = "active"
    expect(await startSignupCheckout(user, "developer", origin)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("creates or resumes the selected plan's checkout for the team", async () => {
    entryState = "payment_failed"
    expect(await startSignupCheckout(user, "developer", origin)).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_1",
    )
    const [url, init] = fetchMock.mock.lastCall as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://api.example.test/stripe/checkout-session")
    expect(JSON.parse(init.body as string)).toEqual({
      offer: "developer_monthly",
      success_url:
        "https://console.example.test/billing/pro/?team=use%3Ateam-1&billing=success",
      cancel_url:
        "https://console.example.test/auth/auth-code-error/?reason=checkout_canceled&offer=developer",
    })
  })

  it("asks for a plan before any checkout when none was selected", async () => {
    expect(await startSignupCheckout(user, undefined, origin)).toBe(
      "/auth/auth-code-error/?reason=plan_required",
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("reports a plan that is no longer sold as recoverable", async () => {
    checkout = { status: 400, body: { error: { code: "invalid_offer" } } }
    expect(await startSignupCheckout(user, "pro_monthly", origin)).toBe(
      "/auth/auth-code-error/?reason=plan_unavailable",
    )
  })

  it("returns to the paid page while a paid checkout settles", async () => {
    checkout = {
      status: 202,
      body: { outcome: "payment_confirmation_pending" },
    }
    expect(await startSignupCheckout(user, "pro_monthly", origin)).toBe(
      "/billing/pro/?team=use%3Ateam-1&billing=success",
    )
  })

  it("throws when checkout cannot start", async () => {
    checkout = { status: 409, body: { error: { code: "plan_conflict" } } }
    await expect(
      startSignupCheckout(user, "pro_monthly", origin),
    ).rejects.toThrow()
  })
})
