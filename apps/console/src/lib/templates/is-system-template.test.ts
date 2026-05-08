import { describe, expect, it } from "vitest"
import { isSystemTemplate } from "./is-system-template"

describe("isSystemTemplate", () => {
  it("returns true for superserve/ prefixed names", () => {
    expect(isSystemTemplate({ name: "superserve/base" })).toBe(true)
    expect(isSystemTemplate({ name: "superserve/python-3.11" })).toBe(true)
  })

  it("returns false for user names", () => {
    expect(isSystemTemplate({ name: "my-template" })).toBe(false)
    expect(isSystemTemplate({ name: "team/custom" })).toBe(false)
    expect(isSystemTemplate({ name: "ss/base" })).toBe(false)
  })

  it("does not treat a trailing superserve/ as a system template", () => {
    expect(isSystemTemplate({ name: "foo/superserve/bar" })).toBe(false)
  })
})
