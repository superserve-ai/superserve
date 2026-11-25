// @vitest-environment node
// Checkout funnel analytics in the API proxy: which plan requests hand their
// backend response to the checkout recorder, and with what context.

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api/proxy-auth", () => ({
  ensureAuthApiKeyForTeam: vi.fn(),
  getAuthApiKeyAndTeamForRecovery: vi.fn(),
  getAuthApiKeyAndTeamForUser: vi.fn(),
  getAuthApiKeyForUser: vi.fn(),
  repairRecoveryAuthApiKeyForTeam: vi.fn(),
}))
vi.mock("@/lib/api/promotion-identity", () => ({
  publishPromotionIdentity: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: vi.fn(),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (region: string) => ({
    region,
    apiBaseUrl: "https://api.test.superserve.ai",
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("@/lib/posthog/checkout", () => ({
  recordProxyCheckout: vi.fn(),
}))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { publishPromotionIdentity } from "@/lib/api/promotion-identity"
import {
  getAuthApiKeyAndTeamForUser,
  getAuthApiKeyForUser,
} from "@/lib/api/proxy-auth"
import { recordProxyCheckout } from "@/lib/posthog/checkout"
import { createServerClient } from "@/lib/supabase/server"

import { POST } from "./route"

const TEAM = "use:team-east"

function post(path: string[], body: unknown, headers?: Record<string, string>) {
  return POST(
    new NextRequest(`https://console.test/api/${path.join("/")}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path }) },
  )
}

function upstream(body: unknown, status = 200) {
  fetchSpy.mockResolvedValue(Response.json(body, { status }))
}

describe("api proxy checkout events", () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    vi.mocked(recordProxyCheckout).mockReset()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    } as never)
    vi.mocked(getAuthApiKeyForUser).mockResolvedValue("ss_live_test_key")
    vi.mocked(getAuthApiKeyAndTeamForUser).mockResolvedValue({
      apiKey: "ss_live_test_key",
      team: { teamId: "team-east", region: "use" },
    })
    vi.mocked(publishPromotionIdentity).mockResolvedValue()
    vi.mocked(getImpersonationContext).mockResolvedValue(null)
  })

  it("hands a created Checkout to the recorder with the offer and return page", async () => {
    upstream({
      id: "cs_test_a1",
      url: "https://checkout.stripe.com/c/pay/cs_test_a1",
    })
    const response = await post(["stripe", "pro-checkout"], {
      expected_team: TEAM,
      offer: "pro_monthly",
      success_url: `https://console.test/billing/pro?billing=success&team=${TEAM}`,
      cancel_url: `https://console.test/billing/pro?billing=cancel&team=${TEAM}`,
    })
    expect(response.status).toBe(200)
    // The client still gets the whole body: the recorder reads a copy.
    expect(await response.json()).toEqual({
      id: "cs_test_a1",
      url: "https://checkout.stripe.com/c/pay/cs_test_a1",
    })
    expect(recordProxyCheckout).toHaveBeenCalledOnce()
    const [input] = vi.mocked(recordProxyCheckout).mock.calls[0]
    expect(input).toMatchObject({
      request: {
        kind: "opened",
        offer: "pro_monthly",
        successUrl: `https://console.test/billing/pro?billing=success&team=${TEAM}`,
      },
      userId: "u1",
      team: { teamId: "team-east", region: "use" },
      base: "https://api.test.superserve.ai",
      apiKey: "ss_live_test_key",
    })
    expect(input.response.status).toBe(200)
  })

  it("hands a recovery to the recorder with the page that asked", async () => {
    upstream({ outcome: "active" })
    const referer = `https://console.test/billing/pro?billing=success&team=${TEAM}`
    await post(
      ["stripe", "pro-checkout", "recover"],
      { expected_team: TEAM, restart: false },
      { referer },
    )
    expect(recordProxyCheckout).toHaveBeenCalledOnce()
    expect(vi.mocked(recordProxyCheckout).mock.calls[0][0]).toMatchObject({
      request: { kind: "recovered", referer },
      userId: "u1",
    })
  })

  it("records nothing for a plan request it refuses or a free plan choice", async () => {
    upstream({ outcome: "committed" })
    await post(["stripe", "pro-checkout"], {
      expected_team: TEAM,
      offer: "enterprise",
      success_url: "https://console.test/onboarding/plan?billing=success",
      cancel_url: "https://console.test/onboarding/plan?billing=cancel",
    })
    await post(["stripe", "plan-choice"], {
      expected_team: TEAM,
      offer: "free",
    })
    expect(recordProxyCheckout).not.toHaveBeenCalled()
  })
})
