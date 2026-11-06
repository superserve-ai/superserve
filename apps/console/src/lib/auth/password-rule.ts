// Supabase Auth rejects a new password that lacks a lowercase letter, an
// uppercase letter, or a digit, and it counts only ASCII ones. Check the same
// rule in the browser so each password form names the missing part before
// submit.
export const PASSWORD_RULE_HINT =
  "Use 8 or more characters with an uppercase letter, a lowercase letter, and a number."

const REQUIRED_PARTS = [
  { pattern: /[a-z]/, label: "a lowercase letter" },
  { pattern: /[A-Z]/, label: "an uppercase letter" },
  { pattern: /[0-9]/, label: "a number" },
] as const

/** The first problem with a new password, or null when it passes. */
export function passwordRuleError(password: string): string | null {
  if (!password) return "Password is required."
  if (password.length < 8) return "Must be at least 8 characters."
  const missing = REQUIRED_PARTS.filter(
    ({ pattern }) => !pattern.test(password),
  ).map(({ label }) => label)
  if (missing.length === 0) return null
  const last = missing.pop()
  if (missing.length === 0) return `Add ${last}.`
  const comma = missing.length > 1 ? "," : ""
  return `Add ${missing.join(", ")}${comma} and ${last}.`
}
