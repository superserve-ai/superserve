// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  impersonation: vi.fn(),
  directory: vi.fn(),
  complete: vi.fn(),
  provision: vi.fn(),
  names: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.user } }),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: mocks.impersonation,
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: mocks.provision,
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: mocks.directory,
}))
vi.mock("@/lib/api/team-provisioning", () => ({
  completedMemberships: mocks.complete,
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: () => ({
    apiBaseUrl: "https://control.example.test",
    createAdminClient: () => ({
      from: () => ({ select: () => ({ in: mocks.names }) }),
    }),
  }),
}))
import {
  parseYCConfirmation,
  ycAccount,
  ycTeams,
  ycRequest,
  YCManualReviewError,
} from "./yc-claims"
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "founder@example.test",
  email_confirmed_at: "2026-10-16T00:00:00Z",
  app_metadata: { provider: "google" },
}
describe("YC account and team boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.user.mockResolvedValue({ data: { user }, error: null })
    mocks.impersonation.mockResolvedValue(null)
    mocks.directory.mockResolvedValue({ memberships: [], degradedRegions: [] })
    mocks.complete.mockImplementation((_id, value) => value)
    mocks.names.mockResolvedValue({
      data: [{ id: "team", name: "Synthetic Team", home_region: "use" }],
      error: null,
    })
  })
  it("uses authenticated verified identity and refuses impersonation", async () => {
    expect((await ycAccount())?.id).toBe(user.id)
    mocks.impersonation.mockResolvedValue({ actor: "operator" })
    await expect(ycAccount()).rejects.toThrow("impersonation")
  })
  it("renders team discovery without provisioning or consuming Google cookies", async () => {
    mocks.provision.mockRejectedValue(
      new Error("cookies cannot change during rendering"),
    )
    expect(await ycTeams(user as never)).toEqual([])
    expect(mocks.provision).not.toHaveBeenCalled()
  })
  it("allows normal first-team setup only in the explicit server action path", async () => {
    mocks.provision.mockImplementation(async () => {
      mocks.directory.mockResolvedValue({
        memberships: [{ teamId: "team", region: "use" }],
        degradedRegions: [],
      })
    })
    expect(await ycTeams(user as never, true)).toEqual([
      { teamId: "team", region: "use", name: "Synthetic Team" },
    ])
    expect(mocks.provision).toHaveBeenCalledTimes(1)
  })
  it("does not infer no teams when a region is unavailable", async () => {
    mocks.directory.mockResolvedValue({
      memberships: [],
      degradedRegions: ["usw"],
    })
    await expect(ycTeams(user as never, true)).rejects.toThrow("incomplete")
    expect(mocks.provision).not.toHaveBeenCalled()
  })
  it("routes unresolved legacy placement to review without offering first-team setup", async () => {
    mocks.directory.mockResolvedValue({
      memberships: [{ teamId: "team", region: "use" }],
      degradedRegions: [],
    })
    mocks.names.mockResolvedValue({
      data: [{ id: "team", name: "Legacy Team", home_region: null }],
      error: null,
    })
    await expect(ycTeams(user as never, true)).rejects.toThrow("manual review")
    expect(mocks.provision).not.toHaveBeenCalled()
  })
  it("rejects malformed and appended proof values", () => {
    expect(parseYCConfirmation(`${user.id}.${"a".repeat(43)}.extra`)).toBeNull()
    expect(parseYCConfirmation(`${user.id}.${"a".repeat(43)}`)?.id).toBe(
      user.id,
    )
  })
})

it("classifies service conflicts as manual review", async () => {
  vi.stubEnv("YC_CLAIM_CONSOLE_TOKEN", "a".repeat(32))
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 409 })),
  )
  try {
    await expect(ycRequest("bind", {})).rejects.toBeInstanceOf(
      YCManualReviewError,
    )
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})
