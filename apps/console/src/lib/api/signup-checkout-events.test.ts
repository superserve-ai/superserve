import type { User } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  opened: vi.fn(),
  completed: vi.fn(),
  entry: "trial_ended" as string,
  checkout: { status: 200, body: {} as unknown },
  recovered: { status: 200, body: {} as unknown },
  operator: false,
}))
vi.mock("./proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: async () => ({
    apiKey: "server-only",
    team: { teamId: "team-1", region: "use" },
  }),
}))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({ apiBaseUrl: "https://api.example.test" }),
}))
vi.mock("@/lib/posthog/checkout", () => ({
  isOperatorView: async () => m.operator,
  recordCheckoutOpened: m.opened,
  recordCheckoutCompleted: m.completed,
}))
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    if (url.endsWith("/billing/plan"))
      return Response.json({ entry_state: m.entry })
    if (url.endsWith("/stripe/pro-checkout/recover"))
      return Response.json(m.recovered.body, { status: m.recovered.status })
    return Response.json(m.checkout.body, { status: m.checkout.status })
  }),
)

import { settleSignupCheckout, startSignupCheckout } from "./signup-checkout"

const user = { id: "u1" } as User
const mine = { account: "u1", team: "use:team-1" }
const origin = "https://console.example.test"
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_1"

beforeEach(() => {
  m.opened.mockReset()
  m.completed.mockReset()
  m.entry = "trial_ended"
  m.operator = false
  m.checkout = {
    status: 200,
    body: { id: "cs_test_1", url: CHECKOUT_URL },
  }
  m.recovered = { status: 200, body: { outcome: "active" } }
})

describe("checkout_opened from the plan picker", () => {
  it("records the opened Checkout with the entry state and the catalog offer", async () => {
    await expect(
      startSignupCheckout(user, "starter", origin, mine, true),
    ).resolves.toBe(CHECKOUT_URL)
    expect(m.opened).toHaveBeenCalledOnce()
    expect(m.opened).toHaveBeenCalledWith({
      userId: "u1",
      surface: "plan_picker",
      team: { teamId: "team-1", region: "use" },
      offer: "developer_monthly",
      base: "https://api.example.test",
      apiKey: "server-only",
      response: { id: "cs_test_1", url: CHECKOUT_URL },
      reason: "trial_ended",
      planSwitch: true,
    })
  })

  it("records nothing when no Checkout opens", async () => {
    m.checkout = { status: 200, body: { outcome: "active" } }
    await startSignupCheckout(user, "pro_monthly", origin, mine)
    m.checkout = { status: 409, body: { error: { code: "plan_conflict" } } }
    await startSignupCheckout(user, "pro_monthly", origin, mine).catch(() => {})
    m.checkout = { status: 200, body: { url: "https://evil.example/pay" } }
    await startSignupCheckout(user, "pro_monthly", origin, mine)
    await startSignupCheckout(user, "pro_monthly", origin, {
      account: "other",
      team: "use:team-1",
    })
    expect(m.opened).not.toHaveBeenCalled()
  })

  it("records nothing while an operator views another team", async () => {
    m.operator = true
    await expect(
      startSignupCheckout(user, "starter", origin, mine, true),
    ).resolves.toBe(CHECKOUT_URL)
    expect(m.opened).not.toHaveBeenCalled()
  })
})

describe("checkout_completed from the plan picker", () => {
  it("is recorded when the payment settles into a paid plan", async () => {
    m.entry = "none"
    await expect(settleSignupCheckout(user, "u1", "use:team-1")).resolves.toBe(
      "/sandboxes",
    )
    expect(m.completed).toHaveBeenCalledWith({
      userId: "u1",
      surface: "plan_picker",
      team: { teamId: "team-1", region: "use" },
      base: "https://api.example.test",
      apiKey: "server-only",
    })
  })

  it("is not recorded while an operator views another team", async () => {
    m.entry = "none"
    m.operator = true
    await expect(settleSignupCheckout(user, "u1", "use:team-1")).resolves.toBe(
      "/sandboxes",
    )
    expect(m.completed).not.toHaveBeenCalled()
  })

  it.each([
    ["still settling", { outcome: "payment_confirmation_pending" }, "none"],
    ["unpaid", { outcome: "active" }, "trial_ended"],
    ["not paid at all", { outcome: "no_pending_pro_purchase" }, "none"],
  ])("is not recorded while %s", async (_, body, entry) => {
    m.recovered = { status: 200, body }
    m.entry = entry
    await settleSignupCheckout(user, "u1", "use:team-1")
    expect(m.completed).not.toHaveBeenCalled()
  })
})
