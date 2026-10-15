import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  team: vi.fn(),
  impersonation: vi.fn(),
  single: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  cookie: vi.fn(),
  cell: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
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
  mocks.eq.mockReturnValue({ maybeSingle: mocks.single })
  mocks.from.mockReturnValue({ select: () => ({ eq: mocks.eq }) })
  mocks.cell.mockReturnValue({
    createAdminClient: () => ({ from: mocks.from }),
  })
})

describe("authoritative signup plan read", () => {
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
