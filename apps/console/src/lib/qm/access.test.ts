import type { User } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { canAccessQm, parseQmBetaAllowlist, qmBetaAllowlist } from "./access"

const staff = {
  email: "ops@superserve.ai",
  app_metadata: { provider: "google" },
} as unknown as User
const customer = {
  email: "dev@example.com",
  app_metadata: { provider: "email" },
} as unknown as User

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
    expect(canAccessQm(customer, "team-a")).toBe(false)
  })

  it("always admits staff", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "")
    expect(canAccessQm(staff, null)).toBe(true)
  })

  it("admits allowlisted teams only", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-a,team-b")
    expect(canAccessQm(customer, "team-a")).toBe(true)
    expect(canAccessQm(customer, "team-z")).toBe(false)
    expect(canAccessQm(customer, null)).toBe(false)
  })

  it("admits everyone with the wildcard", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "*")
    expect(canAccessQm(customer, null)).toBe(true)
    expect(qmBetaAllowlist().everyone).toBe(true)
  })
})
