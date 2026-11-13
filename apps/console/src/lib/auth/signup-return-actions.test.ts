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

  it("sends a visitor with no session to the dashboard entry", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(
      confirmedSignupDestinationAction("pro_monthly", "/"),
    ).resolves.toBe("/")
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

  it("treats a next path that leaves the site as none", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(
      confirmedSignupDestinationAction(undefined, "/\\attacker.example"),
    ).resolves.toBe("/")
  })

  it("keeps the requested path for a visitor with no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(
      confirmedSignupDestinationAction(undefined, "/yc/claim"),
    ).resolves.toBe("/yc/claim")
  })
})
