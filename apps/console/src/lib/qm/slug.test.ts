import { describe, expect, it } from "vitest"

import { sanitizeSlugInput, slugError, slugify, tenantUrl } from "./slug"

describe("slugify", () => {
  it("derives a hostname-safe label from an organization name", () => {
    expect(slugify("Acme, Inc.")).toBe("acme-inc")
    expect(slugify("  Pilot Team  ")).toBe("pilot-team")
    expect(slugify("Ünïcode Löve")).toBe("unicode-love")
    expect(slugify("---")).toBe("")
  })

  it("caps length without leaving a trailing hyphen", () => {
    const slug = slugify("a".repeat(39) + " bcd")
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith("-")).toBe(false)
  })
})

describe("sanitizeSlugInput", () => {
  it("lowercases and strips disallowed characters", () => {
    expect(sanitizeSlugInput("Acme Corp!")).toBe("acmecorp")
    expect(sanitizeSlugInput("my-team_1")).toBe("my-team1")
  })
})

describe("slugError", () => {
  it("rejects empty, short, and malformed slugs", () => {
    expect(slugError("")).toMatch(/choose/i)
    expect(slugError("ab")).toMatch(/at least 3/)
    expect(slugError("-acme")).toMatch(/leading or trailing/)
    expect(slugError("acme-")).toMatch(/leading or trailing/)
    expect(slugError("a".repeat(41))).toMatch(/at most 40/)
  })

  it("accepts well-formed slugs", () => {
    expect(slugError("acme")).toBeNull()
    expect(slugError("pilot-team-2")).toBeNull()
  })
})

describe("tenantUrl", () => {
  it("builds the public URL for a slug", () => {
    expect(tenantUrl("acme")).toBe("https://acme.qm.superserve.ai")
  })
})
