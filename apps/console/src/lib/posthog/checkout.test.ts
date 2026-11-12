import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  queue: [] as (() => Promise<void>)[],
  trackEvent: vi.fn(async () => {}),
  member: vi.fn(async () => true),
  rows: {} as Record<string, { data: unknown; error: unknown }>,
  user: { id: "u1" } as { id: string } | null,
  outsideRequest: false,
}))
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    if (m.outsideRequest) throw new Error("outside a request scope")
    m.queue.push(fn)
  },
}))
vi.mock("./actions", () => ({ trackEvent: m.trackEvent }))
vi.mock("@/lib/api/team-directory", () => ({
  membershipExistsInCell: m.member,
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: m.user } }) },
  }),
}))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({
    apiBaseUrl: "https://api.example.test",
    createAdminClient: () => ({
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          not: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => m.rows[table] ?? { data: null, error: null },
        }
        return query
      },
    }),
  }),
}))

import {
  checkoutSessionId,
  checkoutSurfaceFromUrl,
  offerProperties,
  recordCheckoutCompleted,
  recordCheckoutOpened,
  recordCheckoutReturned,
  recordCheckoutReturnForUser,
  recordProxyCheckout,
} from "./checkout"

const TEAM_ID = "11111111-2222-4333-8444-555555555555"
const TEAM_KEY = `use:${TEAM_ID}`
const team = { region: "use", teamId: TEAM_ID }
const teamProps = {
  team_id: TEAM_ID,
  region: "use",
  $groups: { team: TEAM_ID },
}
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_live_a1B2#fid"

const fetchMock = vi.fn(async (_url: URL | string, _init?: RequestInit) =>
  Response.json({
    offers: [
      {
        offer_key: "pro_monthly",
        family: "pro",
        display_name: "Pro",
        price_cents: 2500,
        interval_months: 1,
        included_credit_cents: null,
        funding_policy: "postpaid",
        topoff: null,
        sellable: true,
      },
    ],
  }),
)
vi.stubGlobal("fetch", fetchMock)

async function flush() {
  const pending = m.queue.splice(0)
  for (const run of pending) await run()
}

beforeEach(() => {
  m.queue.length = 0
  m.trackEvent.mockClear()
  m.member.mockReset().mockResolvedValue(true)
  m.user = { id: "u1" }
  m.rows = {}
  fetchMock.mockClear()
})

describe("checkout property helpers", () => {
  it("reads the Checkout session id from the response id or the Checkout URL", () => {
    expect(checkoutSessionId("cs_test_X1", CHECKOUT_URL)).toBe("cs_test_X1")
    expect(checkoutSessionId(undefined, CHECKOUT_URL)).toBe("cs_live_a1B2")
    expect(checkoutSessionId("sub_123", "https://example.test/x")).toBeNull()
    expect(checkoutSessionId(undefined, "not a url")).toBeNull()
  })

  it("splits an offer key into plan and billing interval", () => {
    expect(offerProperties("developer_monthly")).toEqual({
      offer: "developer_monthly",
      plan: "developer",
      billing_interval: "monthly",
    })
    expect(offerProperties("pro_annual").billing_interval).toBe("annual")
    expect(offerProperties(null)).toEqual({
      offer: null,
      plan: null,
      billing_interval: null,
    })
  })

  it("maps a Checkout return page to its surface and outcome", () => {
    expect(
      checkoutSurfaceFromUrl("https://c.test/billing/pro?billing=success"),
    ).toEqual({ surface: "billing_pro", outcome: "success" })
    expect(
      checkoutSurfaceFromUrl("https://c.test/onboarding/plan/?billing=cancel"),
    ).toEqual({ surface: "onboarding_plan", outcome: "cancel" })
    expect(checkoutSurfaceFromUrl("https://c.test/billing/pro")).toEqual({
      surface: "billing_pro",
      outcome: null,
    })
    expect(checkoutSurfaceFromUrl("https://c.test/sandboxes")).toBeNull()
    expect(checkoutSurfaceFromUrl(null)).toBeNull()
  })
})

describe("checkout_opened", () => {
  it("is sent after the response with the plan, price, reason and session", async () => {
    recordCheckoutOpened({
      userId: "u1",
      surface: "plan_picker",
      team,
      offer: "pro_monthly",
      base: "https://api.example.test",
      apiKey: "key",
      response: { id: "cs_live_a1B2", url: CHECKOUT_URL },
      reason: "trial_ended",
      planSwitch: true,
    })
    expect(m.trackEvent).not.toHaveBeenCalled()
    await flush()
    expect(m.trackEvent).toHaveBeenCalledWith("checkout_opened", "u1", {
      surface: "plan_picker",
      offer: "pro_monthly",
      plan: "pro",
      billing_interval: "monthly",
      price_cents: 2500,
      reason: "trial_ended",
      plan_switch: true,
      checkout_session_id: "cs_live_a1B2",
      ...teamProps,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.example.test/billing/capabilities")
    expect(init?.headers).toEqual({ "X-API-Key": "key" })
  })

  it("still records the checkout when the catalog can't be read", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"))
    recordCheckoutOpened({
      userId: "u1",
      surface: "plan_picker",
      team,
      offer: "developer_monthly",
      base: "https://api.example.test",
      apiKey: "key",
      response: { url: CHECKOUT_URL },
    })
    await flush()
    expect(m.trackEvent).toHaveBeenCalledWith(
      "checkout_opened",
      "u1",
      expect.objectContaining({
        price_cents: null,
        reason: null,
        plan_switch: false,
        checkout_session_id: "cs_live_a1B2",
      }),
    )
  })
})

describe("checkout_returned", () => {
  it("adds the latest checkout's offer and session for a member's team", async () => {
    m.rows.billing_pro_upgrade = {
      data: {
        offer_key: "pro_annual",
        session_id: "cs_live_old",
        amount_cents: 1,
        quoted_at: "2026-11-01T00:00:00Z",
      },
      error: null,
    }
    m.rows.billing_signup_choice = {
      data: {
        offer_key: "pro_monthly",
        session_id: "cs_live_new",
        generation: "2026-11-10T00:00:00Z",
      },
      error: null,
    }
    recordCheckoutReturned({
      userId: "u1",
      surface: "plan_picker",
      outcome: "success",
      teamKey: TEAM_KEY,
    })
    await flush()
    expect(m.member).toHaveBeenCalledWith("use", "u1", TEAM_ID)
    expect(m.trackEvent).toHaveBeenCalledWith("checkout_returned", "u1", {
      surface: "plan_picker",
      outcome: "success",
      offer: "pro_monthly",
      plan: "pro",
      billing_interval: "monthly",
      checkout_session_id: "cs_live_new",
      ...teamProps,
    })
  })

  it("falls back to the offer from the URL when no checkout is on record", async () => {
    recordCheckoutReturned({
      userId: "u1",
      surface: "plan_picker",
      outcome: "cancel",
      teamKey: TEAM_KEY,
      offer: "developer_monthly",
    })
    await flush()
    expect(m.trackEvent).toHaveBeenCalledWith(
      "checkout_returned",
      "u1",
      expect.objectContaining({
        outcome: "cancel",
        offer: "developer_monthly",
        checkout_session_id: null,
      }),
    )
  })

  it("sends nothing for a team the user doesn't belong to or a malformed team", async () => {
    m.member.mockResolvedValue(false)
    recordCheckoutReturned({
      userId: "u1",
      surface: "billing_pro",
      outcome: "success",
      teamKey: TEAM_KEY,
    })
    recordCheckoutReturned({
      userId: "u1",
      surface: "billing_pro",
      outcome: "success",
      teamKey: "use:not-a-team",
    })
    await flush()
    expect(m.queue).toHaveLength(0)
    expect(m.trackEvent).not.toHaveBeenCalled()
  })

  it("records a return for the signed-in user only when the URL names them", async () => {
    await recordCheckoutReturnForUser({
      surface: "plan_picker",
      outcome: "cancel",
      teamKey: TEAM_KEY,
      account: "someone-else",
    })
    m.user = null
    await recordCheckoutReturnForUser({
      surface: "billing_pro",
      outcome: "cancel",
      teamKey: TEAM_KEY,
    })
    expect(m.queue).toHaveLength(0)
    m.user = { id: "u1" }
    await recordCheckoutReturnForUser({
      surface: "billing_pro",
      outcome: "cancel",
      teamKey: TEAM_KEY,
    })
    await flush()
    expect(m.trackEvent).toHaveBeenCalledWith(
      "checkout_returned",
      "u1",
      expect.objectContaining({ surface: "billing_pro", outcome: "cancel" }),
    )
  })
})

describe("checkout_completed", () => {
  const input = {
    userId: "u1",
    surface: "plan_picker" as const,
    team,
    base: "https://api.example.test",
    apiKey: "key",
  }

  it("is sent with the plan, list price and quoted amount of the paid checkout", async () => {
    m.rows.billing_pro_upgrade = {
      data: {
        offer_key: "pro_monthly",
        session_id: "cs_live_paid",
        amount_cents: 1830,
        quoted_at: "2026-11-10T00:00:00Z",
      },
      error: null,
    }
    recordCheckoutCompleted(input)
    expect(m.trackEvent).not.toHaveBeenCalled()
    await flush()
    expect(m.trackEvent).toHaveBeenCalledWith("checkout_completed", "u1", {
      surface: "plan_picker",
      offer: "pro_monthly",
      plan: "pro",
      billing_interval: "monthly",
      price_cents: 2500,
      amount_cents: 1830,
      checkout_session_id: "cs_live_paid",
      ...teamProps,
    })
  })

  it("is sent without a list price when no backend key is given", async () => {
    m.rows.billing_signup_choice = {
      data: {
        offer_key: "pro_monthly",
        session_id: "cs_live_signup",
        generation: "2026-11-10T00:00:00Z",
      },
      error: null,
    }
    recordCheckoutCompleted({ userId: "u1", surface: "onboarding_plan", team })
    await flush()
    expect(m.trackEvent).toHaveBeenCalledWith(
      "checkout_completed",
      "u1",
      expect.objectContaining({
        surface: "onboarding_plan",
        price_cents: null,
        checkout_session_id: "cs_live_signup",
      }),
    )
  })

  it("is not sent for a team with no paid checkout on record", async () => {
    m.rows.billing_signup_choice = {
      data: null,
      error: { code: "42P01" },
    }
    recordCheckoutCompleted(input)
    await flush()
    expect(m.trackEvent).not.toHaveBeenCalled()
  })
})

describe("recordProxyCheckout", () => {
  const base = {
    userId: "u1",
    team,
    base: "https://api.example.test",
    apiKey: "key",
  }

  it("records a created Checkout without consuming the client's response", async () => {
    const response = Response.json({ id: "cs_test_P1", url: CHECKOUT_URL })
    recordProxyCheckout({
      ...base,
      response,
      request: {
        kind: "opened",
        offer: "pro_annual",
        successUrl: "https://c.test/onboarding/plan/?billing=success",
      },
    })
    expect(await response.json()).toEqual({
      id: "cs_test_P1",
      url: CHECKOUT_URL,
    })
    await flush()
    expect(m.trackEvent).toHaveBeenCalledWith(
      "checkout_opened",
      "u1",
      expect.objectContaining({
        surface: "onboarding_plan",
        offer: "pro_annual",
        reason: null,
        checkout_session_id: "cs_test_P1",
      }),
    )
  })

  it("does not count a setup-only Checkout for a card as opened", async () => {
    m.rows.billing_pro_upgrade_setup = { data: { id: "setup" }, error: null }
    recordProxyCheckout({
      ...base,
      response: Response.json({ url: CHECKOUT_URL }),
      request: {
        kind: "opened",
        offer: "pro_monthly",
        successUrl: "https://c.test/billing/pro?billing=success",
      },
    })
    await flush()
    expect(m.trackEvent).not.toHaveBeenCalled()
  })

  it("ignores a refused or non-Checkout response", async () => {
    recordProxyCheckout({
      ...base,
      response: Response.json({ error: {} }, { status: 409 }),
      request: { kind: "opened", offer: "pro_monthly", successUrl: "" },
    })
    recordProxyCheckout({
      ...base,
      response: Response.json({ outcome: "active" }),
      request: { kind: "opened", offer: "pro_monthly", successUrl: "" },
    })
    await flush()
    expect(m.trackEvent).not.toHaveBeenCalled()
  })

  it("completes only an active recovery asked for by a successful return page", async () => {
    m.rows.billing_pro_upgrade = {
      data: {
        offer_key: "pro_monthly",
        session_id: "cs_live_paid",
        amount_cents: 2500,
        quoted_at: "2026-11-10T00:00:00Z",
      },
      error: null,
    }
    const recover = (body: unknown, referer: string | null) =>
      recordProxyCheckout({
        ...base,
        response: Response.json(body),
        request: { kind: "recovered", referer },
      })
    recover({ outcome: "active" }, "https://c.test/billing/pro?team=x")
    recover({ outcome: "active" }, null)
    recover(
      { outcome: "active" },
      "https://c.test/onboarding/plan?billing=success",
    )
    recover(
      { outcome: "payment_confirmation_pending" },
      "https://c.test/billing/pro?billing=success",
    )
    await flush()
    expect(m.trackEvent).not.toHaveBeenCalled()
    recover(
      { outcome: "active" },
      "https://c.test/billing/pro?billing=success&team=x",
    )
    await flush()
    expect(m.trackEvent).toHaveBeenCalledOnce()
    expect(m.trackEvent).toHaveBeenCalledWith(
      "checkout_completed",
      "u1",
      expect.objectContaining({
        surface: "billing_pro",
        checkout_session_id: "cs_live_paid",
        amount_cents: 2500,
      }),
    )
  })
})

describe("outside a request", () => {
  it("does nothing when after() is unavailable", () => {
    m.outsideRequest = true
    try {
      expect(() =>
        recordCheckoutCompleted({
          userId: "u1",
          surface: "plan_picker",
          team,
          base: "https://api.example.test",
          apiKey: "key",
        }),
      ).not.toThrow()
      expect(m.queue).toHaveLength(0)
    } finally {
      m.outsideRequest = false
    }
  })
})
