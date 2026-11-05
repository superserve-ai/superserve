import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  read: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(url), { redirect: true })
  },
  unstable_rethrow: (error: { redirect?: boolean }) => {
    if (error.redirect) throw error
  },
  useRouter: () => ({ refresh: m.refresh }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  }),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  hasImpersonationCookie: async () => false,
  getImpersonationContext: async () => null,
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: async () => ({
    memberships: [{ teamId: "team", region: "use" }],
    degradedRegions: [],
  }),
}))
vi.mock("@/lib/api/team-provisioning", () => ({
  completedMemberships: async (_: string, value: unknown) => value,
}))
vi.mock("@/lib/api/active-team", () => ({
  readTeamSelection: async () => null,
  pickActiveTeam: (teams: unknown[]) => teams[0],
}))
vi.mock("@/lib/api/teams-actions", () => ({
  listTeamsAction: async () => ({
    teams: [{ id: "team", region: "use", name: "Team" }],
    activeTeamId: "team",
    activeRegion: "use",
    regions: ["use"],
  }),
}))
vi.mock("@/lib/api/signup-plan-read", () => ({ readSignupPlan: m.read }))
vi.mock("@/lib/supabase/fresh-fetch", () => ({
  readFresh: <T,>(read: () => Promise<T>) => read(),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    cacheScope: "self",
    teamKey: "use:team",
    ready: true,
  }),
}))
vi.mock("@/components/onboarding/plan-selection-loader", () => ({
  PlanSelectionLoader: () => <h1>We couldn’t confirm your account setup</h1>,
}))
vi.mock("@/components/onboarding/signup-plan-gate", () => ({
  SignupPlanGate: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/layout/dashboard-shell", () => ({
  DashboardShell: (props: { globalBanner: ReactNode; children: ReactNode }) => (
    <>
      {props.globalBanner}
      <main>{props.children}</main>
    </>
  ),
}))
vi.mock("@/components/billing/plan-banner", () => ({
  PlanBanner: () => <p>Plan banner</p>,
}))
vi.mock("@/components/admin/impersonation-banner", () => ({
  ImpersonationBanner: () => null,
}))
vi.mock("@/components/layout/session-expiry-redirect", () => ({
  SessionExpiryRedirect: () => null,
}))
vi.mock("@/components/account-device-recorder", () => ({
  AccountDeviceRecorder: () => null,
}))
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"

import DashboardLayout from "./layout"

const ACTIVE = {
  userId: "owner",
  teamKey: "use:team",
  state: "committed",
  offer: "free",
}

async function renderLayout() {
  render(await DashboardLayout({ children: <p>Sandboxes</p> }))
}

beforeEach(() => {
  vi.clearAllMocks()
  m.read.mockResolvedValue(ACTIVE)
})

describe("dashboard layout when the plan read fails", () => {
  it("renders the console with a plan notice when the read keeps failing", async () => {
    m.read.mockRejectedValue(new Error("Unable to check your plan."))
    await renderLayout()
    expect(screen.getByText("Sandboxes")).toBeVisible()
    expect(screen.getByText(/We couldn’t load your plan details/)).toBeVisible()
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
    expect(
      screen.getByRole("link", { name: "Contact support" }),
    ).toHaveAttribute("href", "mailto:support@superserve.ai")
    // The notice stands in for the plan banner; it assumes no plan.
    expect(screen.queryByText("Plan banner")).toBeNull()
    expect(screen.queryByText(/couldn’t confirm your account setup/)).toBeNull()
  })

  it("keeps the setup gate for a real blocked answer", async () => {
    m.read.mockRejectedValue(new SignupSetupBlockedError("team_changed"))
    await renderLayout()
    expect(
      screen.getByText("We couldn’t confirm your account setup"),
    ).toBeVisible()
    expect(screen.queryByText("Sandboxes")).toBeNull()
    expect(screen.queryByText(/We couldn’t load your plan details/)).toBeNull()
  })

  it("shows no notice when the retry succeeds", async () => {
    m.read
      .mockRejectedValueOnce(new Error("Unable to check your plan."))
      .mockResolvedValueOnce(ACTIVE)
    await renderLayout()
    expect(screen.getByText("Sandboxes")).toBeVisible()
    expect(screen.getByText("Plan banner")).toBeVisible()
    expect(screen.queryByText(/We couldn’t load your plan details/)).toBeNull()
  })

  it("still sends a team that needs a plan to the picker", async () => {
    m.read.mockResolvedValue({ ...ACTIVE, state: "selecting", offer: null })
    await expect(renderLayout()).rejects.toThrow("/onboarding/plan")
  })
})
