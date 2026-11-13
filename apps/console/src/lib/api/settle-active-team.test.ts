import type { User } from "@supabase/supabase-js"
import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  directory: vi.fn(),
  completed: vi.fn(),
  dates: vi.fn(),
  plan: vi.fn(),
}))
vi.mock("@/lib/api/active-team", async (original) => ({
  ...(await original<typeof import("./active-team")>()),
  readTeamSelection: mocks.read,
  writeTeamSelection: mocks.write,
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: mocks.directory,
  readTeamCreationDates: mocks.dates,
}))
vi.mock("@/lib/api/team-provisioning", () => ({
  completedMemberships: mocks.completed,
}))
vi.mock("@/lib/api/signup-plan-read", () => ({ readSignupPlan: mocks.plan }))
import { settleTeamSelection } from "./settle-active-team"

const older = { region: "usw", teamId: "team-z" }
const newer = { region: "use", teamId: "team-a" }
const user = (value?: unknown) =>
  ({
    id: "user-a",
    app_metadata: {},
    aud: "authenticated",
    created_at: "2020-01-01",
    user_metadata: { active_team: value },
  }) as User

beforeEach(() => {
  vi.resetAllMocks()
  mocks.read.mockResolvedValue(null)
  mocks.directory.mockResolvedValue({
    memberships: [newer, older],
    degradedRegions: [],
  })
  mocks.completed.mockImplementation(async (_id, directory) => directory)
  mocks.dates.mockResolvedValue(
    new Map([
      ["usw:team-z", "2020-01-01"],
      ["use:team-a", "2021-01-01"],
    ]),
  )
  mocks.plan.mockResolvedValue({ state: "legacy" })
})
it("keeps a live cookie without reading plans or metadata", async () => {
  mocks.read.mockResolvedValue(newer)
  const input = user()
  Object.defineProperty(input, "user_metadata", {
    get: () => {
      throw Error("unexpected metadata read")
    },
  })
  expect(await settleTeamSelection(input)).toEqual(newer)
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.plan).not.toHaveBeenCalled()
})
it("writes a saved live team", async () => {
  expect(await settleTeamSelection(user("use:team-a"))).toEqual(newer)
  expect(mocks.write).toHaveBeenCalledWith(newer)
  expect(mocks.plan).not.toHaveBeenCalled()
})
it("ignores removed saved and cookie teams", async () => {
  mocks.read.mockResolvedValue({ region: "use", teamId: "removed" })
  expect(await settleTeamSelection(user("use:removed"))).toEqual(older)
  expect(mocks.directory).toHaveBeenCalledWith("user-a", { maxAgeMs: 0 })
})
it("prefers an active older team over a newer low-id gated team", async () => {
  mocks.plan.mockImplementation(async (_id, team) =>
    team === newer
      ? { state: "legacy", entryState: "trial_ended" }
      : { state: "legacy" },
  )
  expect(await settleTeamSelection(user())).toEqual(older)
})
it("skips an older gated team", async () => {
  mocks.plan
    .mockResolvedValueOnce({ state: "selecting" })
    .mockResolvedValueOnce({ state: "legacy" })
  expect(await settleTeamSelection(user())).toEqual(newer)
})
it("uses the oldest when all plans are gated or throw", async () => {
  mocks.plan
    .mockRejectedValueOnce(Error("unavailable"))
    .mockResolvedValueOnce({ state: "selecting" })
  expect(await settleTeamSelection(user())).toEqual(older)
  expect(mocks.plan).toHaveBeenCalledTimes(2)
})
it("checks at most five plans", async () => {
  const memberships = Array.from({ length: 7 }, (_, i) => ({
    region: "use",
    teamId: String(i),
  }))
  mocks.directory.mockResolvedValue({ memberships, degradedRegions: [] })
  mocks.plan.mockResolvedValue({ state: "selecting" })
  await settleTeamSelection(user())
  expect(mocks.plan).toHaveBeenCalledTimes(5)
})
it("does not choose on a degraded directory", async () => {
  mocks.directory.mockResolvedValue({
    memberships: [older],
    degradedRegions: ["use"],
  })
  expect(await settleTeamSelection(user("usw:team-z"))).toBeNull()
  expect(mocks.write).not.toHaveBeenCalled()
})
it("keeps a live cookie during degradation", async () => {
  mocks.directory.mockResolvedValue({
    memberships: [older],
    degradedRegions: ["use"],
  })
  mocks.read.mockResolvedValue(older)
  expect(await settleTeamSelection(user())).toEqual(older)
  expect(mocks.write).not.toHaveBeenCalled()
})
it("avoids plan reads for a single membership", async () => {
  mocks.directory.mockResolvedValue({
    memberships: [older],
    degradedRegions: [],
  })
  expect(await settleTeamSelection(user())).toEqual(older)
  expect(mocks.write).toHaveBeenCalledWith(older)
  expect(mocks.plan).not.toHaveBeenCalled()
})
it("does nothing for zero memberships or read failures", async () => {
  mocks.directory.mockResolvedValue({ memberships: [], degradedRegions: [] })
  expect(await settleTeamSelection(user())).toBeNull()
  mocks.directory.mockRejectedValue(Error("unavailable"))
  expect(await settleTeamSelection(user())).toBeNull()
  expect(mocks.write).not.toHaveBeenCalled()
})
