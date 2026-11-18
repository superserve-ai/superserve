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
import {
  SETTLE_TEAM_DEADLINE_MS,
  settleTeamSelection,
} from "./settle-active-team"

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
it("keeps an active cookie without reading metadata or other plans", async () => {
  mocks.read.mockResolvedValue(newer)
  gateTeam(older)
  const input = user()
  Object.defineProperty(input, "user_metadata", {
    get: () => {
      throw Error("unexpected metadata read")
    },
  })
  expect(await settleTeamSelection(input)).toEqual(newer)
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.plan.mock.calls).toEqual([["user-a", newer]])
})
it("writes a saved active team when another team is gated", async () => {
  gateTeam(older)
  expect(await settleTeamSelection(user("use:team-a"))).toEqual(newer)
  expect(mocks.write).toHaveBeenCalledWith(newer)
  expect(mocks.plan.mock.calls).toEqual([["user-a", newer]])
})
function gateTeam(gated: typeof older) {
  mocks.plan.mockImplementation(async (_id, team) => ({
    state: team === gated ? "selecting" : "legacy",
  }))
}

it.each(["cookie", "metadata"])(
  "skips a gated %s team at sign-in",
  async (source) => {
    if (source === "cookie") mocks.read.mockResolvedValue(older)
    gateTeam(older)
    expect(await settleTeamSelection(user("usw:team-z"))).toEqual(newer)
    expect(mocks.write.mock.calls).toEqual([[newer]])
    expect(mocks.plan.mock.calls).toEqual([
      ["user-a", older],
      ["user-a", newer],
    ])
  },
)

it("prefers the active saved team over an older active team", async () => {
  const [oldest, saved, cookie] = setMemberships(3)
  mocks.read.mockResolvedValue(cookie)
  gateTeam(cookie)
  expect(await settleTeamSelection(user("use:1"))).toEqual(saved)
  expect(mocks.write.mock.calls).toEqual([[saved]])
  expect(mocks.plan.mock.calls).toEqual([
    ["user-a", cookie],
    ["user-a", saved],
  ])
  expect(mocks.plan).not.toHaveBeenCalledWith("user-a", oldest)
})

it.each(["cookie", "metadata"])(
  "keeps the remembered %s team when all teams are gated",
  async (source) => {
    if (source === "cookie") mocks.read.mockResolvedValue(newer)
    mocks.plan.mockResolvedValue({ state: "selecting" })
    expect(
      await settleTeamSelection(
        user(source === "cookie" ? "usw:team-z" : "use:team-a"),
      ),
    ).toEqual(newer)
    expect(mocks.write.mock.calls).toEqual(source === "cookie" ? [] : [[newer]])
    expect(mocks.plan.mock.calls).toEqual([
      ["user-a", newer],
      ["user-a", older],
    ])
  },
)

it("keeps the cookie team when its plan read throws", async () => {
  mocks.read.mockResolvedValue(newer)
  mocks.plan.mockRejectedValueOnce(Error("unavailable"))
  expect(await settleTeamSelection(user("usw:team-z"))).toEqual(newer)
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.plan.mock.calls).toEqual([["user-a", newer]])
})

it("writes the saved team when its plan read throws and there is no cookie", async () => {
  mocks.plan.mockRejectedValueOnce(Error("unavailable"))
  expect(await settleTeamSelection(user("use:team-a"))).toEqual(newer)
  expect(mocks.write.mock.calls).toEqual([[newer]])
  expect(mocks.plan.mock.calls).toEqual([["user-a", newer]])
})

it("skips a saved team whose plan read throws when the cookie team is gated", async () => {
  const [active, saved, cookie] = setMemberships(3)
  mocks.read.mockResolvedValue(cookie)
  mocks.plan
    .mockResolvedValueOnce({ state: "selecting" })
    .mockRejectedValueOnce(Error("unavailable"))
  expect(await settleTeamSelection(user("use:1"))).toEqual(active)
  expect(mocks.write.mock.calls).toEqual([[active]])
  expect(mocks.plan.mock.calls).toEqual([
    ["user-a", cookie],
    ["user-a", saved],
    ["user-a", active],
  ])
})

it.each(["directory", "completed"] as const)(
  "keeps a gated cookie team when %s memberships are degraded",
  async (source) => {
    mocks[source].mockResolvedValue({
      memberships: [older, newer],
      degradedRegions: ["third"],
    })
    mocks.read.mockResolvedValue(older)
    gateTeam(older)
    expect(await settleTeamSelection(user("use:team-a"))).toEqual(older)
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.plan.mock.calls).toEqual([["user-a", older]])
  },
)

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
it.each([older, null])(
  "falls back to cookie %j when a plan read hangs, without writing later",
  async (cookie) => {
    vi.useFakeTimers()
    try {
      mocks.read.mockResolvedValue(cookie)
      let resolvePlan!: (value: { state: string }) => void
      const hangingPlan = new Promise<{ state: string }>((resolve) => {
        resolvePlan = resolve
      })
      if (cookie) mocks.plan.mockResolvedValueOnce({ state: "selecting" })
      mocks.plan.mockReturnValueOnce(hangingPlan)

      const selection = settleTeamSelection(user("use:team-a"))
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.plan).toHaveBeenLastCalledWith("user-a", newer)
      await vi.advanceTimersByTimeAsync(SETTLE_TEAM_DEADLINE_MS)
      expect(await selection).toEqual(cookie)
      expect(mocks.write).not.toHaveBeenCalled()

      resolvePlan({ state: "legacy" })
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.write).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  },
)

function setMemberships(count: number) {
  const memberships = Array.from({ length: count }, (_, i) => ({
    region: "use",
    teamId: String(i),
  }))
  mocks.directory.mockResolvedValue({ memberships, degradedRegions: [] })
  mocks.dates.mockResolvedValue(
    new Map(
      memberships.map((team, i) => [`use:${team.teamId}`, `2020-01-0${i + 1}`]),
    ),
  )
  return memberships
}

it("finds an able sixth team after five gated teams", async () => {
  const memberships = setMemberships(6)
  mocks.plan.mockImplementation(async (_id, team) => ({
    state: team === memberships[5] ? "legacy" : "selecting",
  }))
  expect(await settleTeamSelection(user())).toEqual(memberships[5])
  expect(mocks.write).toHaveBeenCalledWith(memberships[5])
  expect(mocks.plan).toHaveBeenCalledTimes(6)
})
it("chooses the oldest able team even when a younger read resolves first", async () => {
  let resolveOlder!: (value: { state: string }) => void
  const olderPlan = new Promise<{ state: string }>((resolve) => {
    resolveOlder = resolve
  })
  let resolveYounger!: (value: { state: string }) => void
  const youngerPlan = new Promise<{ state: string }>((resolve) => {
    resolveYounger = resolve
  })
  mocks.plan.mockImplementation((_id, team) =>
    team === older ? olderPlan : youngerPlan,
  )
  const selection = settleTeamSelection(user())
  await vi.waitFor(() => expect(mocks.plan).toHaveBeenCalledTimes(2))
  resolveYounger({ state: "legacy" })
  await youngerPlan
  resolveOlder({ state: "legacy" })
  expect(await selection).toEqual(older)
  expect(mocks.write).toHaveBeenCalledWith(older)
  expect(mocks.plan).toHaveBeenCalledTimes(2)
})
it("does not read later batches after finding an able team", async () => {
  const memberships = setMemberships(7)
  expect(await settleTeamSelection(user())).toEqual(memberships[0])
  expect(mocks.plan.mock.calls.map((call) => call[1])).toEqual(
    memberships.slice(0, 5),
  )
})
it("does not start later batches after the deadline", async () => {
  vi.useFakeTimers()
  try {
    const memberships = setMemberships(7)
    let resolveBatch!: (value: { state: string }) => void
    const pendingBatch = new Promise<{ state: string }>((resolve) => {
      resolveBatch = resolve
    })
    mocks.plan.mockReturnValue(pendingBatch)

    const selection = settleTeamSelection(user())
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.plan.mock.calls.map((call) => call[1])).toEqual(
      memberships.slice(0, 5),
    )

    await vi.advanceTimersByTimeAsync(SETTLE_TEAM_DEADLINE_MS)
    expect(await selection).toBeNull()
    resolveBatch({ state: "selecting" })
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.plan).toHaveBeenCalledTimes(5)
    expect(mocks.write).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
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
it.each([false, true])(
  "avoids plan reads for a single membership (cookie: %s)",
  async (withCookie) => {
    if (withCookie) mocks.read.mockResolvedValue(older)
    mocks.directory.mockResolvedValue({
      memberships: [older],
      degradedRegions: [],
    })
    expect(await settleTeamSelection(user())).toEqual(older)
    expect(mocks.write.mock.calls).toEqual(withCookie ? [] : [[older]])
    expect(mocks.plan).not.toHaveBeenCalled()
  },
)
it("does nothing for zero memberships or read failures", async () => {
  mocks.directory.mockResolvedValue({ memberships: [], degradedRegions: [] })
  expect(await settleTeamSelection(user())).toBeNull()
  mocks.directory.mockRejectedValue(Error("unavailable"))
  expect(await settleTeamSelection(user())).toBeNull()
  expect(mocks.write).not.toHaveBeenCalled()
})

it("times out a hanging directory lookup without writing after it resolves", async () => {
  vi.useFakeTimers()
  try {
    const directory = { memberships: [older], degradedRegions: [] }
    let resolveDirectory!: (value: typeof directory) => void
    const pending = new Promise<typeof directory>((resolve) => {
      resolveDirectory = resolve
    })
    mocks.directory.mockReturnValue(pending)

    const selection = settleTeamSelection(user())
    await vi.advanceTimersByTimeAsync(SETTLE_TEAM_DEADLINE_MS)
    expect(await selection).toBeNull()
    expect(mocks.write).not.toHaveBeenCalled()

    resolveDirectory(directory)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.read).toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it("chooses an eligible older team while a younger plan read hangs", async () => {
  vi.useFakeTimers()
  try {
    mocks.plan
      .mockResolvedValueOnce({ state: "legacy" })
      .mockReturnValueOnce(new Promise(() => {}))

    const selection = settleTeamSelection(user())
    await vi.advanceTimersByTimeAsync(SETTLE_TEAM_DEADLINE_MS)
    expect(await selection).toEqual(older)
    expect(mocks.write).toHaveBeenCalledWith(older)
    expect(mocks.plan.mock.calls).toEqual([
      ["user-a", older],
      ["user-a", newer],
    ])
  } finally {
    vi.useRealTimers()
  }
})
