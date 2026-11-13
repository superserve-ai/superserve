// Supabase Auth rejects a new password that lacks a lowercase letter, an
// uppercase letter, or a digit, and it counts only ASCII ones. Check the same
// rule in the browser so each password form names the missing part before
// submit. Auth hashes with bcrypt, which reads only the first 72 bytes, and
// rejects a longer password, so cap the UTF-8 byte length too.
export const PASSWORD_RULE_HINT =
  "Use 8 or more characters with an uppercase letter, a lowercase letter, and a number."

const REQUIRED_PARTS = [
  { pattern: /[a-z]/, label: "a lowercase letter" },
  { pattern: /[A-Z]/, label: "an uppercase letter" },
  { pattern: /[0-9]/, label: "a number" },
] as const

const MAX_PASSWORD_BYTES = 72

/**
 * The length error for a password over bcrypt's 72-byte limit, or null. Server
 * actions use it too, because a direct call can skip the browser check.
 */
export function passwordTooLongError(password: string): string | null {
  if (new TextEncoder().encode(password).length <= MAX_PASSWORD_BYTES)
    return null
  return [...password].length > MAX_PASSWORD_BYTES
    ? "Use 72 characters or fewer."
    : "Use 72 characters or fewer. Accented letters, symbols, and emoji count as more than one."
}

/** The first problem with a new password, or null when it passes. */
export function passwordRuleError(password: string): string | null {
  if (!password) return "Password is required."
  if (password.length < 8) return "Must be at least 8 characters."
  const tooLong = passwordTooLongError(password)
  if (tooLong) return tooLong
  const missing = REQUIRED_PARTS.filter(
    ({ pattern }) => !pattern.test(password),
  ).map(({ label }) => label)
  if (missing.length === 0) return null
  const last = missing.pop()
  if (missing.length === 0) return `Add ${last}.`
  const comma = missing.length > 1 ? "," : ""
  return `Add ${missing.join(", ")}${comma} and ${last}.`
}
