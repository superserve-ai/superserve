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

import {
  confirmSignupCheckout,
  signupEntryDestination,
  startSignupCheckout,
} from "./signup-checkout"

const user = { id: "u1" } as User
const origin = "https://console.example.test"
let entryState: string
let checkout: { status: number; body: unknown }
let checkouts: { status: number; body: unknown }[] = []
let recovered: { status: number; body: unknown } = {
  status: 200,
  body: { outcome: "retryable" },
}
const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith("/billing/plan"))
    return Response.json({ entry_state: entryState })
  if (url.endsWith("/stripe/pro-checkout/recover"))
    return Response.json(recovered.body, { status: recovered.status })
  const next = checkouts.shift() ?? checkout
  return Response.json(next.body, { status: next.status })
})

describe("startSignupCheckout", () => {
  beforeEach(() => {
    entryState = "trial"
    checkout = {
      status: 200,
      body: { url: "https://checkout.stripe.com/c/pay/cs_test_1" },
    }
    checkouts = []
    recovered = { status: 200, body: { outcome: "retryable" } }
    fetchMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
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
        "https://console.example.test/api/onboarding/checkout/return/?account=u1&team=use%3Ateam-1",
      cancel_url:
        "https://console.example.test/auth/choose-plan/?reason=checkout_canceled&offer=developer",
    })
  })

  it.each([
    ["trial", "/sandboxes"],
    ["trial_ended", "/auth/choose-plan/?reason=trial_ended&offer=developer"],
    [
      "payment_failed",
      "/auth/choose-plan/?reason=payment_failed&offer=developer",
    ],
  ])("lands a new %s signup in the console", async (state, destination) => {
    entryState = state
    expect(await signupEntryDestination(user, "developer")).toBe(destination)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["active", "pending_payment", undefined])(
    "keeps today's flow when the backend reports %s",
    async (state) => {
      entryState = state as string
      expect(await signupEntryDestination(user, "developer")).toBeNull()
      expect(await startSignupCheckout(user, "developer", origin)).toBeNull()
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/checkout-session"),
        ),
      ).toBe(false)
    },
  )

  it("reports a plan that is no longer sold as recoverable", async () => {
    checkout = { status: 400, body: { error: { code: "invalid_offer" } } }
    expect(await startSignupCheckout(user, "pro_monthly", origin)).toBe(
      "/auth/choose-plan/?reason=plan_unavailable",
    )
  })

  it("returns to the paid page while a paid checkout settles", async () => {
    checkout = {
      status: 202,
      body: { outcome: "payment_confirmation_pending" },
    }
    expect(await startSignupCheckout(user, "pro_monthly", origin)).toBe(
      "/api/onboarding/checkout/return/?account=u1&team=use%3Ateam-1",
    )
  })

  it("throws when checkout cannot start", async () => {
    checkout = { status: 409, body: { error: { code: "plan_conflict" } } }
    await expect(
      startSignupCheckout(user, "pro_monthly", origin),
    ).rejects.toThrow()
  })

  it("replaces an open checkout for another plan only on an explicit choice", async () => {
    const conflict = { status: 409, body: { error: { code: "plan_conflict" } } }
    checkouts = [conflict]
    await expect(
      startSignupCheckout(user, "pro_monthly", origin),
    ).rejects.toThrow()
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/recover")),
    ).toBe(false)

    checkouts = [conflict]
    expect(await startSignupCheckout(user, "pro_monthly", origin, true)).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_1",
    )
    const restart = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/stripe/pro-checkout/recover"),
    ) as unknown as [string, RequestInit]
    expect(JSON.parse(restart[1].body as string)).toEqual({ restart: true })
  })

  it.each([
    [200, { outcome: "active" }, "/sandboxes"],
    [
      200,
      {
        outcome: "payment_method_required",
        url: "https://checkout.stripe.com/c/pay/cs_setup",
      },
      "https://checkout.stripe.com/c/pay/cs_setup",
    ],
    [
      202,
      { outcome: "payment_confirmation_pending" },
      "/auth/choose-plan/?reason=payment_confirming&account=u1&team=use%3Ateam-1",
    ],
    [200, { outcome: "active", url: "https://other.example/x" }, "/sandboxes"],
    [
      200,
      { outcome: "payment_method_required", url: "https://other.example/x" },
      "/auth/choose-plan/?reason=payment_confirming&account=u1&team=use%3Ateam-1",
    ],
  ])(
    "settles a paid checkout before the dashboard (%s %j)",
    async (status, body, destination) => {
      recovered = { status, body }
      expect(await confirmSignupCheckout(user, "u1", "use:team-1")).toBe(
        destination,
      )
    },
  )

  it.each([
    ["other-user", "use:team-1"],
    ["u1", "use:other-team"],
    [null, null],
  ])(
    "never confirms a checkout started by account %s on team %s",
    async (account, team) => {
      recovered = { status: 200, body: { outcome: "active" } }
      expect(await confirmSignupCheckout(user, account, team)).toBe(
        "/auth/choose-plan/?reason=checkout_elsewhere",
      )
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/recover")),
      ).toBe(false)
    },
  )
})
