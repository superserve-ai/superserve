import { describe, expect, it } from "vitest"
import { isSystemTemplate } from "./is-system-template"

describe("isSystemTemplate", () => {
  it("returns true for ss/ prefixed aliases", () => {
    expect(isSystemTemplate({ alias: "ss/base" })).toBe(true)
    expect(isSystemTemplate({ alias: "ss/python-ml" })).toBe(true)
  })

  it("returns false for user aliases", () => {
    expect(isSystemTemplate({ alias: "my-template" })).toBe(false)
    expect(isSystemTemplate({ alias: "team/custom" })).toBe(false)
  })

  it("does not treat a trailing ss/ as a system template", () => {
    expect(isSystemTemplate({ alias: "foo/ss/bar" })).toBe(false)
  })
})
