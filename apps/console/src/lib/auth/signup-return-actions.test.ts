import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))
const cookieJar = vi.hoisted(() => new Map<string, string>())
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
  }),
}))
const pricing = vi.hoisted(() => vi.fn())
vi.mock("@/lib/billing/plans-actions", () => ({
  getPublicBillingPlansAction: async () => ({
    pricing_version: await pricing(),
  }),
}))
const signupPlan = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: (...args: unknown[]) => signupPlan(...args),
}))
// The real signupEntryDestination runs, so the backend answer decides the
// step just as it does for the confirmation link.
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: async () => ({
    apiKey: "server-only",
    team: { teamId: "team-1", region: "use" },
  }),
}))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({ apiBaseUrl: "https://api.example.test" }),
  DEFAULT_REGION: "use",
}))

import { SignupRestrictedError } from "./signup-restrictions"
import { confirmedSignupDestinationAction } from "./signup-return-actions"

let plan: { ok: boolean; body: unknown }
const fetchMock = vi.fn(async () => ({
  ok: plan.ok,
  status: plan.ok ? 200 : 503,
  json: async () => plan.body,
}))

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } })
  cookieJar.clear()
  pricing.mockReset()
  pricing.mockResolvedValue("v2")
  signupPlan.mockReset()
  signupPlan.mockResolvedValue({})
  plan = { ok: true, body: { entry_state: "trial" } }
  fetchMock.mockClear()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("confirmedSignupDestinationAction", () => {
  it("sends a new Pro trial to the console, not the upgrade page", async () => {
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe("/sandboxes")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/billing/plan",
      expect.anything(),
    )
  })

  it("sends an unfinished YC claim to its claim page first", async () => {
    cookieJar.set("yc_claim_confirmation", "pending")
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe("/yc/claim")
    await expect(
      confirmedSignupDestinationAction(undefined, "/"),
    ).resolves.toBe("/yc/claim")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends a team whose trial is used up to its plan picker", async () => {
    plan = { ok: true, body: { entry_state: "trial_ended" } }
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe(
      "/auth/choose-plan/?reason=trial_ended&offer=pro_monthly&account=u1&team=use%3Ateam-1",
    )
  })

  it("asks the backend without an offer too", async () => {
    await expect(
      confirmedSignupDestinationAction(undefined, "/"),
    ).resolves.toBe("/sandboxes")
  })

  it("takes the dashboard entry when the team state lookup fails", async () => {
    // The callback's own lookup may have sent a trial to the console.
    plan = { ok: false, body: {} }
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe("/")
  })

  it("keeps the offer's landing page when the team awaits no plan", async () => {
    plan = { ok: true, body: {} }
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe("/billing/pro/")
  })

  it("takes the dashboard entry when pricing cannot be read for an offer", async () => {
    // The callback's own pricing read may have worked and sent a trial to
    // the console, so this tab must not guess the upgrade page.
    pricing.mockRejectedValue(new Error("Plans are unavailable"))
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe("/")
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/billing/pro/"),
    ).resolves.toBe("/")
    await expect(
      confirmedSignupDestinationAction("enterprise", "/yc/claim"),
    ).resolves.toBe("/")
  })

  it("keeps a step every pricing version takes when pricing cannot be read", async () => {
    pricing.mockRejectedValue(new Error("Plans are unavailable"))
    await expect(
      confirmedSignupDestinationAction(undefined, "/yc/claim"),
    ).resolves.toBe("/yc/claim")
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/yc/claim"),
    ).resolves.toBe("/yc/claim")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses the offer's landing page under legacy pricing", async () => {
    pricing.mockResolvedValue("legacy")
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe("/billing/pro/")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("leaves an Enterprise sign-up to the dashboard entry", async () => {
    await expect(
      confirmedSignupDestinationAction("enterprise", "/"),
    ).resolves.toBe("/")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails without a signed-in user, so the tab takes its own fallback", async () => {
    // A failed lookup can keep the session, so no step is guessed here.
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/billing/pro/"),
    ).rejects.toThrow()
    getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Service Unavailable"),
    })
    await expect(
      confirmedSignupDestinationAction(undefined, "/yc/claim"),
    ).rejects.toThrow()
    expect(pricing).not.toHaveBeenCalled()
  })

  it("routes an explicit offer landing page through the team state", async () => {
    // As /auth/callback does for next=/billing/pro/ on a new sign-up.
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/billing/pro/"),
    ).resolves.toBe("/sandboxes")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    plan = { ok: false, body: {} }
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/billing/pro/"),
    ).resolves.toBe("/")
  })

  it("keeps an explicit landing page ahead of a YC claim, as the callback does", async () => {
    cookieJar.set("yc_claim_confirmation", "pending")
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/billing/pro/"),
    ).resolves.toBe("/sandboxes")
  })

  it("sends a plain console path through the team state", async () => {
    plan = { ok: true, body: { entry_state: "trial_ended" } }
    await expect(
      confirmedSignupDestinationAction(undefined, "/templates"),
    ).resolves.toBe(
      "/auth/choose-plan/?reason=trial_ended&account=u1&team=use%3Ateam-1",
    )
  })

  it("keeps an explicit step the confirmation email carries", async () => {
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/yc/claim"),
    ).resolves.toBe("/yc/claim")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("drops a next path the confirmation email drops, as the callback sees it", async () => {
    // The email keeps only billing, YC, device and invite steps, so the
    // callback picks its default step for anything else.
    pricing.mockResolvedValue("legacy")
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/templates"),
    ).resolves.toBe("/billing/pro/")
    pricing.mockResolvedValue("v2")
    plan = { ok: true, body: { entry_state: "trial_ended" } }
    await expect(
      confirmedSignupDestinationAction(undefined, "/onboarding/plan/?team=t"),
    ).resolves.toBe(
      "/auth/choose-plan/?reason=trial_ended&account=u1&team=use%3Ateam-1",
    )
  })

  it("sets up the first team before a payment step, as the callback does", async () => {
    pricing.mockResolvedValue("legacy")
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe("/billing/pro/")
    expect(signupPlan).toHaveBeenCalledWith(
      undefined,
      "u1",
      undefined,
      "/billing/pro/",
    )
  })

  it("takes the callback's recovery when first-team setup fails", async () => {
    // The session survives a failed setup, and the payment page alone would
    // lose its continuation in the dashboard's generic preparation.
    signupPlan.mockRejectedValue(new Error("directory unavailable"))
    await expect(
      confirmedSignupDestinationAction(
        undefined,
        "/billing-usage/buy-credit/?amount=500",
      ),
    ).resolves.toBe(
      `/auth/auth-code-error?${new URLSearchParams({
        reason: "account_setup",
        account: "u1",
        next: "/billing-usage/buy-credit/?amount=500",
      })}`,
    )
    pricing.mockRejectedValue(new Error("Plans are unavailable"))
    await expect(
      confirmedSignupDestinationAction(
        undefined,
        "/billing-usage/buy-credit/?amount=500",
      ),
    ).resolves.toMatch(/^\/auth\/auth-code-error\?reason=account_setup&/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("gives a restricted sign-up the callback's restriction notice", async () => {
    signupPlan.mockRejectedValue(new SignupRestrictedError())
    await expect(
      confirmedSignupDestinationAction(undefined, "/billing/pro/"),
    ).resolves.toBe("/auth/auth-code-error?reason=signup_blocked")
  })

  it("treats a next path that leaves the site as none", async () => {
    await expect(
      confirmedSignupDestinationAction(undefined, "/\\attacker.example"),
    ).resolves.toBe("/sandboxes")
  })
})
