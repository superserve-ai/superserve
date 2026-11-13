import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  read: vi.fn(),
  completed: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({
  GoogleSignupRecoveryRequiredError: class extends Error {},
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  }),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: async () => null,
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: async () => ({
    apiKey: "server-key",
    team: { region: "use", teamId: "team" },
  }),
}))
vi.mock("@/lib/api/signup-plan-read", () => ({ readSignupPlan: m.read }))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({ apiBaseUrl: "https://api.example.test" }),
}))
vi.mock("@/lib/posthog/checkout", () => ({
  recordCheckoutCompleted: m.completed,
}))

import { getSignupPlanAction } from "./signup-plan-actions"

const plan = (state: string, offer: string | null, teamKey = "use:team") => ({
  userId: "owner",
  teamKey,
  state,
  offer,
})

beforeEach(() => vi.clearAllMocks())

it("completes a paid Checkout the refresh finds committed after a successful return", async () => {
  m.read.mockResolvedValue(plan("committed", "pro_monthly"))
  await getSignupPlanAction("use:team", "owner", "success")
  expect(m.completed).toHaveBeenCalledOnce()
  expect(m.completed).toHaveBeenCalledWith({
    userId: "owner",
    surface: "onboarding_plan",
    team: { region: "use", teamId: "team" },
    base: "https://api.example.test",
    apiKey: "server-key",
  })
})

it("completes nothing while pending, for a free plan, without a success return or for another team", async () => {
  m.read.mockResolvedValue(plan("pending", "pro_monthly"))
  await getSignupPlanAction("use:team", "owner", "success")
  m.read.mockResolvedValue(plan("committed", "free"))
  await getSignupPlanAction("use:team", "owner", "success")
  m.read.mockResolvedValue(plan("committed", "pro_monthly"))
  await getSignupPlanAction("use:team", "owner", "cancel")
  await getSignupPlanAction("use:team", "owner")
  m.read.mockResolvedValue(plan("committed", "pro_monthly", "usw:other"))
  await getSignupPlanAction("use:team", "owner", "success")
  expect(m.completed).not.toHaveBeenCalled()
})

it("leaves the completion to the onboarding page when called by the preparation route", async () => {
  m.read.mockResolvedValue(plan("committed", "pro_monthly"))
  await getSignupPlanAction("use:team", "owner", "success", undefined, false)
  expect(m.completed).not.toHaveBeenCalled()
})
