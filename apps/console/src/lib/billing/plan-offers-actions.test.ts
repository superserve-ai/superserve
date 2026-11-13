import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  team: vi.fn(),
  cell: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  legacyEntry: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.user } }),
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: mocks.team,
}))
vi.mock("@/lib/cells", () => ({ cellFor: mocks.cell }))

import {
  getLegacyPlanEntryAction,
  getTrialOutcomeAction,
} from "./plan-offers-actions"

const locator = { account: "user", team: "usw:west-team" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: "user" } } })
  mocks.team.mockResolvedValue({
    apiKey: "test-api-key",
    team: { teamId: "west-team", region: "usw" },
  })
  mocks.legacyEntry.mockResolvedValue({ data: null, error: null })
  mocks.eq.mockReturnValue({ maybeSingle: mocks.legacyEntry })
  mocks.from.mockReturnValue({ select: () => ({ eq: mocks.eq }) })
  mocks.cell.mockReturnValue({
    apiBaseUrl: "https://api.test",
    createAdminClient: () => ({ from: mocks.from }),
  })
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({ trial: { state: "exhausted" }, trial_block: null }),
    ),
  )
  vi.stubGlobal("fetch", mocks.fetch)
})

afterEach(() => vi.unstubAllGlobals())

describe("getLegacyPlanEntryAction", () => {
  it.each([true, false])(
    "returns the durable flag (%s) for the active team",
    async (migrated) => {
      mocks.legacyEntry.mockResolvedValue({
        data: migrated ? { team_id: "west-team" } : null,
        error: null,
      })
      expect(await getLegacyPlanEntryAction(locator.team)).toBe(migrated)
      expect(mocks.team).toHaveBeenCalledWith({ id: "user" })
      expect(mocks.cell).toHaveBeenCalledWith("usw")
      expect(mocks.from).toHaveBeenCalledWith("billing_legacy_plan_entry")
      expect(mocks.eq).toHaveBeenCalledWith("team_id", "west-team")
    },
  )

  it.each(["use:west-team", "usw:other-team"])(
    "does not read the flag for another team (%s)",
    async (teamKey) => {
      expect(await getLegacyPlanEntryAction(teamKey)).toBe(false)
      expect(mocks.from).not.toHaveBeenCalled()
    },
  )

  it("returns false when the flag cannot be read", async () => {
    mocks.legacyEntry.mockResolvedValue({
      data: null,
      error: { code: "XX000" },
    })
    expect(await getLegacyPlanEntryAction(locator.team)).toBe(false)
  })

  it("does not read the flag without a signed-in user", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } })
    expect(await getLegacyPlanEntryAction(locator.team)).toBe(false)
    expect(mocks.team).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe("getTrialOutcomeAction", () => {
  it("uses neutral copy for a migrated team with exhausted credit", async () => {
    mocks.legacyEntry.mockResolvedValue({
      data: { team_id: "west-team" },
      error: null,
    })
    expect(await getTrialOutcomeAction(locator)).toBe("unknown")
    expect(mocks.cell).toHaveBeenCalledWith("usw")
    expect(mocks.from).toHaveBeenCalledWith("billing_legacy_plan_entry")
    expect(mocks.eq).toHaveBeenCalledWith("team_id", "west-team")
    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL("https://api.test/billing/summary"),
      expect.objectContaining({
        headers: { "X-API-Key": "test-api-key" },
        cache: "no-store",
      }),
    )
  })

  it("reports an exhausted trial for a team that was not migrated", async () => {
    expect(await getTrialOutcomeAction(locator)).toBe("ended")
  })

  it("stays neutral when migration status cannot be read", async () => {
    mocks.legacyEntry.mockResolvedValue({
      data: null,
      error: { code: "XX000" },
    })
    expect(await getTrialOutcomeAction(locator)).toBeNull()
  })

  it.each(["PGRST205", "42P01"])(
    "keeps today's trial outcome when the migration table is missing (%s)",
    async (code) => {
      mocks.legacyEntry.mockResolvedValue({ data: null, error: { code } })
      expect(await getTrialOutcomeAction(locator)).toBe("ended")
    },
  )

  it.each([
    { account: "other-user", team: locator.team },
    { account: locator.account, team: "use:other-team" },
  ])("checks the locator before reading billing (%j)", async (other) => {
    expect(await getTrialOutcomeAction(other)).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
