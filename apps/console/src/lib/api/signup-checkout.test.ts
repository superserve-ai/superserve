import { beforeEach, describe, expect, it, vi } from "vitest"

const provision = vi.hoisted(() => vi.fn())
vi.mock("./proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: async () => (
    provision(),
    {
      apiKey: "server-only",
      team: { teamId: "team-1", region: "use" },
    }
  ),
}))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({ apiBaseUrl: "https://api.example.test" }),
}))

import type { User } from "@supabase/supabase-js"

import {
  awaitingPlanRedirect,
  isAwaitingPlanState,
} from "@/lib/billing/signup-checkout-paths"

import {
  settleSignupCheckout,
  signupEntryDestination,
  startSignupCheckout,
} from "./signup-checkout"

const user = { id: "u1" } as User
const mine = { account: "u1", team: "use:team-1" }
const pinned = "account=u1&team=use%3Ateam-1"
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
    provision.mockClear()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("creates or resumes the selected plan's checkout for the team", async () => {
    entryState = "payment_failed"
    expect(await startSignupCheckout(user, "developer", origin, mine)).toBe(
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
        "https://console.example.test/auth/choose-plan/?reason=checkout_canceled&offer=developer&account=u1&team=use%3Ateam-1",
    })
  })

  it.each([
    ["trial", "/sandboxes"],
    [
      "trial_ended",
      `/auth/choose-plan/?reason=trial_ended&offer=developer&${pinned}`,
    ],
    [
      "payment_failed",
      `/auth/choose-plan/?reason=payment_failed&offer=developer&${pinned}`,
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
      expect(
        await startSignupCheckout(user, "developer", origin, mine),
      ).toBeNull()
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/checkout-session"),
        ),
      ).toBe(false)
    },
  )

  it("reports a plan that is no longer sold as recoverable", async () => {
    checkout = { status: 400, body: { error: { code: "invalid_offer" } } }
    expect(await startSignupCheckout(user, "pro_monthly", origin, mine)).toBe(
      `/auth/choose-plan/?reason=plan_unavailable&${pinned}`,
    )
  })

  it("returns to the paid page while a paid checkout settles", async () => {
    checkout = {
      status: 202,
      body: { outcome: "payment_confirmation_pending" },
    }
    expect(await startSignupCheckout(user, "pro_monthly", origin, mine)).toBe(
      "/api/onboarding/checkout/return/?account=u1&team=use%3Ateam-1",
    )
  })

  it.each([
    { account: "other-user", team: "use:team-1" },
    { account: "u1", team: "use:other-team" },
  ])(
    "never touches checkout when the session no longer matches %j",
    async (expected) => {
      expect(
        await startSignupCheckout(user, "developer", origin, expected, true),
      ).toBe("/auth/choose-plan/?reason=checkout_elsewhere")
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringMatching(/checkout-session|recover/),
        expect.anything(),
      )
    },
  )

  it("throws when checkout cannot start", async () => {
    checkout = { status: 409, body: { error: { code: "plan_conflict" } } }
    await expect(
      startSignupCheckout(user, "pro_monthly", origin, mine),
    ).rejects.toThrow()
  })

  it("replaces an open checkout for another plan only on an explicit choice", async () => {
    const conflict = { status: 409, body: { error: { code: "plan_conflict" } } }
    checkouts = [conflict]
    await expect(
      startSignupCheckout(user, "pro_monthly", origin, mine),
    ).rejects.toThrow()
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/recover")),
    ).toBe(false)

    checkouts = [conflict]
    expect(
      await startSignupCheckout(user, "pro_monthly", origin, mine, true),
    ).toBe("https://checkout.stripe.com/c/pay/cs_test_1")
    const restart = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/stripe/pro-checkout/recover"),
    ) as unknown as [string, RequestInit]
    expect(JSON.parse(restart[1].body as string)).toEqual({ restart: true })
  })

  it.each([
    [200, { outcome: "active" }, "/sandboxes"],
    [200, { outcome: "retryable" }, "/sandboxes"],
    [200, { outcome: "no_pending_pro_purchase" }, "/sandboxes"],
    [
      200,
      {
        outcome: "payment_method_required",
        url: "https://checkout.stripe.com/c/pay/cs_setup",
      },
      "https://checkout.stripe.com/c/pay/cs_setup",
    ],
    [202, { outcome: "payment_confirmation_pending" }, null],
    [200, { outcome: "active", url: "https://other.example/x" }, "/sandboxes"],
    [
      200,
      {
        outcome: "payment_method_required",
        url: "https://checkout.stripe.com.evil.example/c/pay/cs_x",
      },
      null,
    ],
    [
      200,
      { outcome: "payment_method_required", url: "https://other.example/x" },
      null,
    ],
  ])(
    "settles a paid checkout before the dashboard (%s %j)",
    async (status, body, destination) => {
      recovered = { status, body }
      expect(await settleSignupCheckout(user, "u1", "use:team-1")).toBe(
        destination,
      )
    },
  )

  it.each([
    [
      200,
      "trial_ended",
      "/auth/choose-plan/?reason=trial_ended&account=u1&team=use%3Ateam-1",
    ],
    [
      409,
      "trial_ended",
      "/auth/choose-plan/?reason=trial_ended&account=u1&team=use%3Ateam-1",
    ],
    [
      200,
      "payment_failed",
      "/auth/choose-plan/?reason=payment_failed&account=u1&team=use%3Ateam-1",
    ],
    [
      200,
      "plan_required",
      "/auth/choose-plan/?reason=plan_required&account=u1&team=use%3Ateam-1",
    ],
    [200, "activating", null],
    [409, "activating", null],
    [200, "trial", "/sandboxes"],
  ])(
    "decides a %s return with nothing pending from the %s entry",
    async (status, entry, destination) => {
      entryState = entry
      recovered = { status, body: { outcome: "no_pending_pro_purchase" } }
      expect(await settleSignupCheckout(user, "u1", "use:team-1")).toBe(
        destination,
      )
    },
  )

  it("waits while the payment status read fails", async () => {
    recovered = { status: 503, body: {} }
    expect(await settleSignupCheckout(user, "u1", "use:team-1")).toBeNull()
  })

  it.each(["trial_ended", "plan_required"])(
    "holds an active payment until the entry state leaves %s",
    async (entry) => {
      entryState = entry
      recovered = { status: 200, body: { outcome: "active" } }
      expect(await settleSignupCheckout(user, "u1", "use:team-1")).toBeNull()
    },
  )

  it.each([
    "active",
    "no_pending_pro_purchase",
    "retryable",
    "payment_confirmation_pending",
  ])(
    "never hands the dashboard a %s return it would send back to the wait",
    async (outcome) => {
      for (const entry of [
        "trial",
        "trial_ended",
        "plan_required",
        "payment_failed",
        "activating",
        "none",
      ]) {
        entryState = entry
        recovered = { status: 200, body: { outcome } }
        const destination = await settleSignupCheckout(user, "u1", "use:team-1")
        if (destination !== "/sandboxes") continue
        const contexts =
          entry === "activating"
            ? [{ paymentSettling: true }]
            : isAwaitingPlanState(entry)
              ? [
                  { entryState: entry, paymentSettling: false },
                  { entryState: entry, paymentSettling: true },
                ]
              : [{ paymentSettling: false }]
        for (const context of contexts)
          expect(
            awaitingPlanRedirect({
              userId: "u1",
              teamKey: "use:team-1",
              ...context,
            }),
          ).not.toBe("/onboarding/payment/?account=u1&team=use%3Ateam-1")
      }
    },
  )

  it("never starts another checkout while a paid one is activating", async () => {
    entryState = "activating"
    expect(
      await startSignupCheckout(user, "developer", origin, mine),
    ).toBeNull()
    expect(await signupEntryDestination(user, "developer")).toBe(
      `/onboarding/payment/?${pinned}`,
    )
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/stripe/checkout-session"),
      ),
    ).toBe(false)
  })

  it.each([
    [
      "other-user",
      "use:team-1",
      "/auth/choose-plan/?reason=checkout_elsewhere&account=other-user&team=use%3Ateam-1",
    ],
    [
      "u1",
      "use:other-team",
      "/auth/choose-plan/?reason=checkout_elsewhere&account=u1&team=use%3Aother-team",
    ],
    [null, null, "/auth/choose-plan/?reason=checkout_elsewhere"],
  ])(
    "never confirms a checkout started by account %s on team %s",
    async (account, team, destination) => {
      recovered = { status: 200, body: { outcome: "active" } }
      expect(await settleSignupCheckout(user, account, team)).toBe(destination)
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/recover")),
      ).toBe(false)
    },
  )

  it("refuses another account before resolving or provisioning a team", async () => {
    const other = { account: "other-user", team: "use:team-1" }
    expect(
      await startSignupCheckout(user, "developer", origin, other, true),
    ).toBe("/auth/choose-plan/?reason=checkout_elsewhere")
    expect(await settleSignupCheckout(user, "other-user", "use:team-1")).toBe(
      "/auth/choose-plan/?reason=checkout_elsewhere&account=other-user&team=use%3Ateam-1",
    )
    expect(await settleSignupCheckout(user, null, null)).toBe(
      "/auth/choose-plan/?reason=checkout_elsewhere",
    )
    expect(provision).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
