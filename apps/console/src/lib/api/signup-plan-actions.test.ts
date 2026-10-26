import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  team: vi.fn(),
  impersonation: vi.fn(),
  single: vi.fn(),
  upgrade: vi.fn(),
  intent: vi.fn(),
  billing: vi.fn(),
  assignment: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  cookie: vi.fn(),
  cell: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  unstable_rethrow: (error: Error) => {
    if (error.message.startsWith("redirect:")) throw error
  },
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({
  GoogleSignupRecoveryRequiredError: class extends Error {},
}))
import { GoogleSignupRecoveryRequiredError } from "@/lib/auth/google-signup-proof"
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.user } }),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: mocks.impersonation,
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: mocks.team,
}))
vi.mock("@/lib/cells", () => ({ cellFor: mocks.cell }))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookie }),
}))

import { needsPlanSelection } from "./signup-plan"
import { getSignupPlanAction } from "./signup-plan-actions"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: "user" } } })
  mocks.team.mockResolvedValue({
    team: { teamId: "west-team", region: "usw" },
    apiKey: "server-only",
  })
  mocks.impersonation.mockResolvedValue(null)
  mocks.cookie.mockReturnValue(undefined)
  mocks.single.mockResolvedValue({
    data: { state: "selecting", offer_key: null },
    error: null,
  })
  mocks.intent.mockResolvedValue({ data: null, error: null })
  mocks.upgrade.mockResolvedValue({ data: null, error: null })
  mocks.billing.mockResolvedValue({ data: null, error: null })
  mocks.assignment.mockResolvedValue({
    data: null,
    error: { code: "PGRST205" },
  })
  mocks.from.mockImplementation((table: string) =>
    table === "team_plan_assignment"
      ? {
          select: () => ({
            eq: () => ({
              lte: () => ({ or: () => ({ limit: mocks.assignment }) }),
            }),
          }),
        }
      : {
          select: () => ({
            eq: (...args: unknown[]) => {
              mocks.eq(...args)
              if (table === "billing_pro_upgrade")
                return { not: () => ({ maybeSingle: mocks.upgrade }) }
              return {
                maybeSingle:
                  table === "yc_claim_team_intent"
                    ? mocks.intent
                    : table === "billing_yc_operation"
                      ? mocks.billing
                      : mocks.single,
              }
            },
          }),
        },
  )
  mocks.cell.mockReturnValue({
    createAdminClient: () => ({ from: mocks.from }),
  })
})

describe("authoritative signup plan read", () => {
  it("routes a team with an unreleased claim through YC without granting a plan", async () => {
    mocks.intent.mockResolvedValue({
      data: { claim_id: "claim", released_at: null },
      error: null,
    })
    const result = await getSignupPlanAction("usw:west-team")
    expect(result.state).toBe("yc_claim")
    expect(result.offer).toBeNull()
    expect(mocks.eq).toHaveBeenLastCalledWith("team_id", "west-team")
  })
  it.each([
    ["selecting", null],
    ["pending", "pro_monthly"],
  ])(
    "skips the legacy plan picker for a %s team with a pricing v2 plan",
    async (state, offer_key) => {
      mocks.single.mockResolvedValue({
        data: { state, offer_key },
        error: null,
      })
      mocks.assignment.mockResolvedValue({ data: [{ id: "a1" }], error: null })
      const result = await getSignupPlanAction()
      expect(result.state).toBe("legacy")
      expect(needsPlanSelection(result)).toBe(false)
    },
  )
  it("keeps today's plan selection when the team has no pricing v2 plan", async () => {
    mocks.assignment.mockResolvedValue({ data: [], error: null })
    expect((await getSignupPlanAction()).state).toBe("selecting")
  })
  it("keeps today's plan selection on cells without plan assignments", async () => {
    expect((await getSignupPlanAction()).state).toBe("selecting")
  })
  it("blocks rather than skipping the picker when assignments can't be read", async () => {
    mocks.assignment.mockResolvedValue({ data: null, error: { code: "57014" } })
    await expect(getSignupPlanAction()).rejects.toThrow(
      "Unable to check your plan",
    )
  })
  it("returns rejected claims to ordinary plan selection", async () => {
    mocks.intent.mockResolvedValue({
      data: { claim_id: "claim", released_at: "2026-10-16" },
      error: null,
    })
    expect((await getSignupPlanAction()).state).toBe("selecting")
  })
  it.each(["intent", "billing"] as const)(
    "routes a pending purchase through an authoritative YC %s",
    async (authority) => {
      mocks.single.mockResolvedValue({
        data: { state: "pending", offer_key: "pro_monthly" },
        error: null,
      })
      mocks[authority].mockResolvedValue({
        data:
          authority === "intent"
            ? { claim_id: "claim", released_at: null }
            : { id: "operation" },
        error: null,
      })
      expect(await getSignupPlanAction()).toMatchObject({
        state: "yc_claim",
        offer: null,
      })
    },
  )
  it.each([null, { claim_id: "claim", released_at: "2026-10-16" }])(
    "preserves pending purchase recovery without a live YC fence (%j)",
    async (intent) => {
      mocks.single.mockResolvedValue({
        data: { state: "pending", offer_key: "pro_monthly" },
        error: null,
      })
      mocks.intent.mockResolvedValue({ data: intent, error: null })
      expect(await getSignupPlanAction()).toMatchObject({
        state: "pending",
        offer: "pro_monthly",
      })
    },
  )
  it("preserves an already committed ordinary purchase", async () => {
    mocks.single.mockResolvedValue({
      data: { state: "committed", offer_key: "pro_monthly" },
      error: null,
    })
    mocks.intent.mockResolvedValue({
      data: { claim_id: "claim", released_at: null },
      error: null,
    })
    expect(await getSignupPlanAction()).toMatchObject({
      state: "committed",
      offer: "pro_monthly",
    })
    expect(mocks.intent).not.toHaveBeenCalled()
    expect(mocks.billing).not.toHaveBeenCalled()
  })
  it.each(["active", "renewed"])(
    "preserves dashboard access after revoking %s billing",
    async (state) => {
      mocks.intent.mockResolvedValue({
        data: { claim_id: "claim", released_at: "2026-10-16" },
        error: null,
      })
      mocks.billing.mockResolvedValue({
        data: { id: "operation", state, revoked_at: "2026-10-16" },
        error: null,
      })
      expect((await getSignupPlanAction()).state).toBe("yc_claim")
    },
  )
  it("recognizes operator-managed YC billing without a public claim", async () => {
    mocks.billing.mockResolvedValue({ data: { id: "operation" }, error: null })
    expect((await getSignupPlanAction()).state).toBe("yc_claim")
  })
  it("does not infer ordinary onboarding from an unavailable billing read", async () => {
    mocks.billing.mockResolvedValue({
      data: null,
      error: { code: "network_error" },
    })
    await expect(getSignupPlanAction()).rejects.toThrow("Unable to check")
  })
  it("blocks on uncertain claim reads but supports cells before the claim migration", async () => {
    mocks.intent.mockResolvedValue({
      data: null,
      error: { code: "network_error" },
    })
    await expect(getSignupPlanAction()).rejects.toThrow("Unable to check")
    mocks.intent.mockResolvedValue({ data: null, error: { code: "42P01" } })
    expect((await getSignupPlanAction()).state).toBe("selecting")
  })
  it("reads only the resolved home team's state and exposes no provider payload", async () => {
    const result = await getSignupPlanAction("usw:west-team")
    expect(mocks.cell).toHaveBeenCalledWith("usw")
    expect(mocks.eq).toHaveBeenCalledWith("team_id", "west-team")
    expect(result).toEqual({
      userId: "user",
      teamKey: "usw:west-team",
      state: "selecting",
      offer: null,
      requestedOffer: undefined,
    })
  })
  it("rejects unauthenticated, impersonated, and changed-team reads", async () => {
    await expect(getSignupPlanAction("use:other")).rejects.toThrow(
      "active team changed",
    )
    expect(mocks.single).not.toHaveBeenCalled()
    mocks.impersonation.mockResolvedValue({ teamId: "other" })
    await expect(getSignupPlanAction()).rejects.toThrow("impersonation")
    mocks.user.mockResolvedValue({ data: { user: null } })
    await expect(getSignupPlanAction()).rejects.toThrow("redirect:/auth/signin")
  })
  it("does not force an existing team with no signup record through onboarding", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null })
    expect((await getSignupPlanAction()).state).toBe("legacy")
  })
  it("fails closed on read errors and malformed states", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { code: "network_error" },
    })
    await expect(getSignupPlanAction()).rejects.toThrow("Unable to check")
    mocks.single.mockResolvedValue({
      data: { state: "unknown", offer_key: "pro_annual" },
      error: null,
    })
    await expect(getSignupPlanAction()).rejects.toThrow("Plan status")
  })
  it("retains the initiating checkout identity when authentication expires", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } })
    await expect(
      getSignupPlanAction("usw:west-team", "user", "success"),
    ).rejects.toThrow("redirect:")
    const destination = new URL(
      mocks.redirect.mock.lastCall![0],
      "https://console.superserve.ai",
    )
    const next = new URL(
      destination.searchParams.get("next")!,
      destination.origin,
    )
    expect(next.searchParams.get("team")).toBe("usw:west-team")
    expect(next.searchParams.get("account")).toBe("user")
    expect(next.searchParams.get("billing")).toBe("success")
  })
  it("recovers Google signup when its proof has expired", async () => {
    mocks.team.mockRejectedValue(new GoogleSignupRecoveryRequiredError())
    await expect(getSignupPlanAction()).rejects.toThrow(
      "redirect:/auth/signup?complete_google=1",
    )
    expect(mocks.single).not.toHaveBeenCalled()
  })
  it("rejects a checkout return from a different account before provisioning", async () => {
    await expect(
      getSignupPlanAction("usw:west-team", "other-user"),
    ).rejects.toThrow("account changed")
    expect(mocks.team).not.toHaveBeenCalled()
  })
  it("leaves legacy behavior in cells where the migration has not been deployed", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "42P01" } })
    expect((await getSignupPlanAction()).state).toBe("legacy")
  })
})

it.each([
  "/billing/pro/?team=usw%3Awest-team&billing=success",
  "/plan-usage/buy-credit/",
])(
  "retains account-bound paid setup after session expiration and Google proof recovery: %s",
  async (next) => {
    mocks.user.mockResolvedValueOnce({ data: { user: null } })
    const expired = await getSignupPlanAction(
      "usw:west-team",
      "user",
      undefined,
      next,
    ).catch((error) => error.message.replace(/^redirect:/, ""))
    const signin = new URL(expired, "https://console.test")
    expect(signin.pathname).toBe("/auth/signin")
    const retry = new URL(signin.searchParams.get("next")!, signin)
    expect(retry.pathname).toBe("/api/onboarding/prepare/")
    expect(retry.searchParams.get("next")).toBe(next)
    expect(retry.searchParams.get("account")).toBe("user")
    expect(retry.searchParams.get("team")).toBe("usw:west-team")
    mocks.team.mockRejectedValueOnce(new GoogleSignupRecoveryRequiredError())
    const proof = await getSignupPlanAction(
      "usw:west-team",
      "user",
      undefined,
      next,
    ).catch((error) => error.message.replace(/^redirect:/, ""))
    const signup = new URL(proof, signin)
    expect(signup.pathname).toBe("/auth/signup")
    expect(signup.searchParams.get("complete_google")).toBe("1")
    expect(signup.searchParams.get("next")).toBe(retry.pathname + retry.search)
    mocks.user.mockResolvedValueOnce({
      data: { user: { id: "other-account" } },
    })
    const before = mocks.team.mock.calls.length
    await expect(
      getSignupPlanAction("usw:west-team", "user", undefined, next),
    ).rejects.toThrow("Your account changed")
    expect(mocks.team.mock.calls.length).toBe(before)
  },
)

describe("real paid preparation handler permanent recovery", () => {
  const endpoint = (account = "user") =>
    new Request(
      `https://console.test/api/onboarding/prepare/?account=${account}&next=%2Fbilling%2Fpro%2F`,
    )
  async function failure(request: Request) {
    const { GET } = await import("@/app/api/onboarding/prepare/route")
    return GET(request).catch(
      (error) => new URL(error.message.replace(/^redirect:/, ""), request.url),
    )
  }
  it("surfaces account A's link while signed in as B without provisioning or retrying blindly", async () => {
    const result = await failure(endpoint("account-A"))
    if (!result) throw new Error("Expected blocked recovery")
    expect(result.searchParams.get("reason")).toBe("account_changed")
    expect(result.searchParams.get("account")).toBe("account-A")
    expect(result.searchParams.get("next")).toBe("/billing/pro/")
    expect(mocks.team).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it("retains an outer-only team pin in a wrong-account recovery destination", async () => {
    const url = new URL(endpoint("account-A").url)
    url.searchParams.set("team", "use:original")
    const result = await failure(new Request(url))
    if (!result) throw new Error("Expected blocked recovery")
    expect(result.searchParams.get("reason")).toBe("account_changed")
    expect(
      new URL(result.searchParams.get("next")!, url).searchParams.get("team"),
    ).toBe("use:original")
    expect(mocks.team).not.toHaveBeenCalled()
  })
  it("surfaces impersonation before any team or billing action", async () => {
    mocks.impersonation.mockResolvedValue({ teamId: "impersonated" })
    const result = await failure(endpoint())
    if (!result) throw new Error("Expected blocked recovery")
    expect(result.searchParams.get("reason")).toBe("impersonation")
    expect(result.searchParams.get("account")).toBe("user")
    expect(mocks.team).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it("surfaces contradictory team locators before any setup action", async () => {
    const url = new URL(endpoint().url)
    url.searchParams.set("team", "use:original")
    url.searchParams.set("next", "/billing/pro/?team=use%3Aother")
    const result = await failure(new Request(url))
    if (!result) throw new Error("Expected blocked recovery")
    expect(result.searchParams.get("reason")).toBe("team_conflict")
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.team).not.toHaveBeenCalled()
  })
  it("surfaces a changed active team from the actual signup plan reader", async () => {
    const url = new URL(endpoint().url)
    url.searchParams.set("next", "/billing/pro/?team=use%3Aoriginal")
    const result = await failure(new Request(url))
    if (!result) throw new Error("Expected blocked recovery")
    expect(result.searchParams.get("reason")).toBe("team_changed")
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it("keeps unclassified/transient failures retryable without trusting their text", async () => {
    mocks.team.mockRejectedValue(
      new Error("Plan setup is unavailable during impersonation"),
    )
    const result = await failure(endpoint())
    if (!result) throw new Error("Expected retry")
    expect(result.searchParams.get("reason")).toBe("account_setup")
    expect(result.searchParams.get("next")).toBe("/billing/pro/")
  })
})
