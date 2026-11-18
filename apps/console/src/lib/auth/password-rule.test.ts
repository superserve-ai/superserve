import { describe, expect, it } from "vitest"

import { passwordRuleError, passwordRuleFailure } from "./password-rule"

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

  it("accepts up to 72 bytes and rejects a longer password", () => {
    const base = "Sandbox42"
    expect(passwordRuleError(base.padEnd(72, "x"))).toBeNull()
    expect(passwordRuleError(base.padEnd(73, "x"))).toBe(
      "Use 72 characters or fewer.",
    )
  })

  it("counts UTF-8 bytes, as bcrypt does", () => {
    // 9 ASCII characters plus 32 two-byte letters: 41 characters, 73 bytes.
    expect(passwordRuleError("Sandbox42" + "é".repeat(32))).toBe(
      "Use 72 characters or fewer. Accented letters, symbols, and emoji count as more than one.",
    )
    // 63 bytes plus one 4-byte emoji is 67 bytes, still within the cap.
    expect(passwordRuleError("Sandbox42".padEnd(63, "x") + "🙂")).toBeNull()
    // 68 bytes plus one 4-byte emoji is exactly 72 bytes; one more byte fails.
    expect(passwordRuleError("Sandbox42".padEnd(68, "x") + "🙂")).toBeNull()
    expect(passwordRuleError("Sandbox42".padEnd(69, "x") + "🙂")).toBe(
      "Use 72 characters or fewer. Accented letters, symbols, and emoji count as more than one.",
    )
  })

  it("names a missing part only after the length checks pass", () => {
    expect(passwordRuleError("x".repeat(73))).toBe(
      "Use 72 characters or fewer.",
    )
  })
})

describe("passwordRuleFailure", () => {
  it.each([
    ["", { rule: "required", missing: [] }],
    ["Ab1", { rule: "too_short", missing: [] }],
    ["x".repeat(73), { rule: "too_long", missing: [] }],
    ["Sandbox42".padEnd(69, "x") + "🙂", { rule: "too_long", missing: [] }],
    ["SANDBOX42", { rule: "missing_characters", missing: ["lowercase"] }],
    ["sandbox42", { rule: "missing_characters", missing: ["uppercase"] }],
    ["Sandboxes", { rule: "missing_characters", missing: ["number"] }],
    [
      "sandboxes",
      { rule: "missing_characters", missing: ["uppercase", "number"] },
    ],
    [
      "!!!!!!!!",
      {
        rule: "missing_characters",
        missing: ["lowercase", "uppercase", "number"],
      },
    ],
    ["Sandbox42", null],
    ["Sandbox42".padEnd(68, "x") + "🙂", null],
  ] as const)("classifies %j in validation order", (password, failure) => {
    expect(passwordRuleFailure(password)).toEqual(failure)
  })

  it.each([
    "",
    "Ab1",
    "Sandbox42".padEnd(73, "x"),
    "Sandbox42".padEnd(68, "x") + "🙂",
    "Sandbox42" + "é".repeat(32),
    "SANDBOX42",
    "sandbox42",
    "Sandboxes",
    "sandboxes",
    "!!!!!!!!",
    "ÉÀÜéàü١٢",
    "Sandbox42",
  ])("matches passwordRuleError's validity for %j", (password) => {
    expect(passwordRuleFailure(password) === null).toBe(
      passwordRuleError(password) === null,
    )
  })
})
