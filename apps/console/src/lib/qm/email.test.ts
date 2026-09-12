import { describe, expect, it } from "vitest"

import { adminEmailError, isFreeMailDomain } from "./email"

describe("isFreeMailDomain", () => {
  it("flags common consumer providers, case-insensitively", () => {
    expect(isFreeMailDomain("me@gmail.com")).toBe(true)
    expect(isFreeMailDomain("me@Outlook.COM")).toBe(true)
    expect(isFreeMailDomain("me@example.com")).toBe(false)
    expect(isFreeMailDomain("not-an-email")).toBe(false)
  })
})

describe("adminEmailError", () => {
  it("requires a well-formed work address", () => {
    expect(adminEmailError("")).toMatch(/enter/i)
    expect(adminEmailError("nope")).toMatch(/valid email/i)
    expect(adminEmailError("me@gmail.com")).toMatch(/work address/i)
    expect(adminEmailError("me@example.com")).toBeNull()
  })
})
