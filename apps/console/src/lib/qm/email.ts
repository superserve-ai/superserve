/**
 * Client-side hint only. The admin address becomes the stack's first
 * administrator and receives its sign-in email, so it should be a work
 * address. The server is authoritative; this just catches the obvious
 * cases before a round-trip.
 */
const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "hey.com",
  "fastmail.com",
  "tutanota.com",
  "tuta.io",
  "qq.com",
  "163.com",
  "126.com",
])

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@")
  if (at === -1) return null
  return (
    email
      .slice(at + 1)
      .trim()
      .toLowerCase() || null
  )
}

export function isFreeMailDomain(email: string): boolean {
  const domain = emailDomain(email)
  return domain !== null && FREE_MAIL_DOMAINS.has(domain)
}

/** Validation message for the admin email, or null when it looks fine. */
export function adminEmailError(email: string): string | null {
  const trimmed = email.trim()
  if (!trimmed) return "Enter the address of the stack's first admin."
  if (!EMAIL_PATTERN.test(trimmed)) return "Enter a valid email address."
  if (isFreeMailDomain(trimmed)) {
    return `Use a work address — ${emailDomain(trimmed)} accounts can't administer a stack.`
  }
  return null
}
