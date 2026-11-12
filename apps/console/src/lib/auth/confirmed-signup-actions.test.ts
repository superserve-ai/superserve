import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))
const pricing = vi.hoisted(() => vi.fn())
vi.mock("@/lib/billing/plans-actions", () => ({
  getPricingVersionAction: () => pricing(),
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

import { confirmedSignupDestinationAction } from "./confirmed-signup-actions"

let plan: { ok: boolean; body: unknown }
const fetchMock = vi.fn(async () => ({
  ok: plan.ok,
  status: plan.ok ? 200 : 503,
  json: async () => plan.body,
}))

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } })
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
    await expect(confirmedSignupDestinationAction("pro_monthly")).resolves.toBe(
      "/sandboxes",
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/billing/plan",
      expect.anything(),
    )
  })

  it("sends a team whose trial is used up to its plan picker", async () => {
    plan = { ok: true, body: { entry_state: "trial_ended" } }
    await expect(confirmedSignupDestinationAction("pro_monthly")).resolves.toBe(
      "/auth/choose-plan/?reason=trial_ended&offer=pro_monthly&account=u1&team=use%3Ateam-1",
    )
  })

  it("asks the backend without an offer too", async () => {
    await expect(confirmedSignupDestinationAction(undefined)).resolves.toBe(
      "/sandboxes",
    )
  })

  it("uses the offer's landing page when the team state is unknown", async () => {
    plan = { ok: false, body: {} }
    await expect(confirmedSignupDestinationAction("pro_monthly")).resolves.toBe(
      "/billing/pro/",
    )
  })

  it("uses the offer's landing page under legacy pricing", async () => {
    pricing.mockResolvedValue("legacy")
    await expect(confirmedSignupDestinationAction("pro_monthly")).resolves.toBe(
      "/billing/pro/",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("leaves an Enterprise sign-up to the dashboard entry", async () => {
    await expect(confirmedSignupDestinationAction("enterprise")).resolves.toBe(
      "/",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends a visitor with no session to the dashboard entry", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(confirmedSignupDestinationAction("pro_monthly")).resolves.toBe(
      "/",
    )
    expect(pricing).not.toHaveBeenCalled()
  })
})
