import { describe, expect, it } from "vitest"

import { passwordRuleError } from "./password-rule"

describe("passwordRuleError", () => {
  it("accepts a password with every required part", () => {
    expect(passwordRuleError("Sandbox42")).toBeNull()
  })

  it("keeps the existing messages for empty and short passwords", () => {
    expect(passwordRuleError("")).toBe("Password is required.")
    expect(passwordRuleError("Ab1")).toBe("Must be at least 8 characters.")
  })

  it("names each missing part", () => {
    expect(passwordRuleError("sandbox42")).toBe("Add an uppercase letter.")
    expect(passwordRuleError("SANDBOX42")).toBe("Add a lowercase letter.")
    expect(passwordRuleError("Sandboxes")).toBe("Add a number.")
    expect(passwordRuleError("sandboxes")).toBe(
      "Add an uppercase letter and a number.",
    )
    expect(passwordRuleError("!!!!!!!!")).toBe(
      "Add a lowercase letter, an uppercase letter, and a number.",
    )
  })

  it("counts only ASCII letters and digits, as the server does", () => {
    expect(passwordRuleError("ÉÀÜéàü١٢")).toBe(
      "Add a lowercase letter, an uppercase letter, and a number.",
    )
    expect(passwordRuleError("ÉcoleX12")).toBeNull()
  })
})
