import { afterEach, describe, expect, it, vi } from "vitest"

import { canAccessQm, parseQmBetaAllowlist, qmBetaAllowlist } from "./access"

describe("parseQmBetaAllowlist", () => {
  it("treats unset and blank as closed", () => {
    expect(parseQmBetaAllowlist(undefined)).toEqual({
      everyone: false,
      teamIds: new Set(),
    })
    expect(parseQmBetaAllowlist(" , ")).toEqual({
      everyone: false,
      teamIds: new Set(),
    })
  })

  it("parses team ids and the wildcard", () => {
    const list = parseQmBetaAllowlist(" team-a, team-b ,*")
    expect(list.everyone).toBe(true)
    expect([...list.teamIds]).toEqual(["team-a", "team-b"])
  })
})

describe("canAccessQm", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("is closed by default", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "")
    expect(canAccessQm("team-a")).toBe(false)
  })

  it("admits allowlisted teams only", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-a,team-b")
    expect(canAccessQm("team-a")).toBe(true)
    expect(canAccessQm("team-z")).toBe(false)
    expect(canAccessQm(null)).toBe(false)
  })

  it("admits everyone with the wildcard", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "*")
    expect(canAccessQm(null)).toBe(true)
    expect(qmBetaAllowlist().everyone).toBe(true)
  })
})
