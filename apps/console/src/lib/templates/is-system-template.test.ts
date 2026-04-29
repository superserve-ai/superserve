import { describe, expect, it } from "vitest"
import { isSystemTemplate } from "./is-system-template"

describe("isSystemTemplate", () => {
  it("returns true for superserve/ prefixed aliases", () => {
    expect(isSystemTemplate({ alias: "superserve/base" })).toBe(true)
    expect(isSystemTemplate({ alias: "superserve/python-3.11" })).toBe(true)
  })

  it("returns false for user aliases", () => {
    expect(isSystemTemplate({ alias: "my-template" })).toBe(false)
    expect(isSystemTemplate({ alias: "team/custom" })).toBe(false)
    expect(isSystemTemplate({ alias: "ss/base" })).toBe(false)
  })

  it("does not treat a trailing superserve/ as a system template", () => {
    expect(isSystemTemplate({ alias: "foo/superserve/bar" })).toBe(false)
  })
})
