import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  user: "6f1c2b9e-1d1a-4c7e-9a55-0f3e2d1c4b5a",
  cookie: undefined as string | undefined,
  regions: ["use", "usw"],
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      m.cookie === undefined ? undefined : { value: `${m.user}:${m.cookie}` },
  }),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => m.regions,
}))

import {
  FirstTeamRegionRequiredError,
  firstTeamTarget,
} from "./first-team-region"

beforeEach(() => {
  m.cookie = undefined
  m.regions = ["use", "usw"]
})

it("keeps the East default when only one region is offered", async () => {
  m.regions = ["use"]
  await expect(firstTeamTarget(m.user)).resolves.toEqual({ region: "use" })
})

it("requires a choice when more than one region is offered", async () => {
  await expect(firstTeamTarget(m.user)).rejects.toBeInstanceOf(
    FirstTeamRegionRequiredError,
  )
  m.cookie = "eu"
  await expect(firstTeamTarget(m.user)).rejects.toBeInstanceOf(
    FirstTeamRegionRequiredError,
  )
})

it("keeps East on the user-id locator", async () => {
  m.cookie = "use"
  await expect(firstTeamTarget(m.user)).resolves.toEqual({ region: "use" })
})

it("gives another region a stable creation id distinct from the user", async () => {
  m.cookie = "usw"
  const first = await firstTeamTarget(m.user)
  const retry = await firstTeamTarget(m.user)
  expect(first.region).toBe("usw")
  expect(first.operationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(first.operationId).not.toBe(m.user)
  expect(retry).toEqual(first)
})

it("ignores a choice another account made on the same browser", async () => {
  m.cookie = "usw"
  await expect(firstTeamTarget("another-user")).rejects.toBeInstanceOf(
    FirstTeamRegionRequiredError,
  )
})
