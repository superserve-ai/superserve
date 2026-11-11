import "server-only"
import { isIPv4, isIPv6 } from "node:net"

import {
  type AuthRateLimit,
  consumeAuthRateLimit,
  consumeAuthRateLimitOutcome,
} from "@/lib/auth/rate-limit"
import sendToSlackHook from "@/lib/slack/send-to-webhook"

// The password reset and sign-in link actions create recovery tokens with the
// admin generateLink API and send the email themselves. That path skips the
// limits Supabase Auth applies to its own /recover endpoint, so these limits
// take their place: one email per address per minute, hourly limits per
// account and per client network, and a project-wide hourly backstop.

// One bucket for both actions: every recovery token replaces the previous one,
// so a second request inside the minute would break the link just sent.
const RECOVERY_EMAIL_COOLDOWN: AuthRateLimit = {
  bucket: "recovery_email_cooldown",
  max: 1,
  windowSeconds: 60,
}

// Shared by both actions and well below the project budget, so one caller
// cannot use up the budget and stop recovery email for everyone else.
const RECOVERY_EMAIL_IP_LIMIT: AuthRateLimit = {
  bucket: "recovery_email_ip",
  max: 10,
  windowSeconds: 60 * 60,
}
const RECOVERY_EMAIL_ACCOUNT_LIMIT: AuthRateLimit = {
  bucket: "recovery_email_account",
  max: 5,
  windowSeconds: 60 * 60,
}
// At most one alert per hour when the project budget is used up.
const BUDGET_ALERT_LIMIT: AuthRateLimit = {
  bucket: "recovery_email_budget_alert",
  max: 1,
  windowSeconds: 60 * 60,
}

// A backstop above normal use, not the limit callers usually meet.
const DEFAULT_RECOVERY_EMAILS_PER_HOUR = 100
const MAX_RECOVERY_EMAILS_PER_HOUR = 100_000
const PROJECT_KEY = "project"
// Every send takes the one project key, so concurrent sends find it locked.
// About 1.5 s in total, inside the after() work that sends the email.
const BUSY_RETRY_DELAYS_MS = [50, 100, 200, 400, 800]

export function recoveryEmailHourlyLimit(): AuthRateLimit {
  const raw = process.env.AUTH_RECOVERY_EMAILS_PER_HOUR?.trim()
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : NaN
  const max =
    parsed >= 1 && parsed <= MAX_RECOVERY_EMAILS_PER_HOUR
      ? parsed
      : DEFAULT_RECOVERY_EMAILS_PER_HOUR
  return { bucket: "recovery_email_project", max, windowSeconds: 60 * 60 }
}

function expandIPv6(ip: string): string[] | null {
  let address = ip.toLowerCase().split("%")[0]
  // An embedded IPv4 tail, such as ::ffff:192.0.2.1, is two groups.
  const tail = address.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number)
    address =
      address.slice(0, tail.index) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = address.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  return [...head, ...Array<string>(missing).fill("0"), ...rest].map((group) =>
    Number.parseInt(group, 16).toString(16),
  )
}

/**
 * The key for the per-network limit. An IPv6 client usually controls a whole
 * /64, so it could rotate addresses to get a fresh budget; the key is the /64
 * prefix. IPv4 addresses, including IPv4-mapped IPv6, are kept whole.
 */
export function recoveryClientNetworkKey(ip: string): string {
  const trimmed = ip.trim()
  if (isIPv4(trimmed)) return trimmed
  if (!isIPv6(trimmed)) return trimmed.toLowerCase()
  const groups = expandIPv6(trimmed)
  if (!groups) return trimmed.toLowerCase()
  if (groups.slice(0, 6).join(":") === "0:0:0:0:0:ffff") {
    const [high, low] = groups
      .slice(6)
      .map((group) => Number.parseInt(group, 16))
    return [high >> 8, high & 255, low >> 8, low & 255].join(".")
  }
  return `${groups.slice(0, 4).join(":")}::/64`
}

export type RecoveryEmailReservation =
  | "reserved"
  | "address_limit"
  | "cooldown"
  | "account_limit"
  | "budget_used_up"
  | "budget_busy"

async function reportBudgetUsedUp(max: number) {
  console.error("Recovery email hourly budget used up:", max)
  try {
    if (!(await consumeAuthRateLimit(BUDGET_ALERT_LIMIT, PROJECT_KEY))) return
    await sendToSlackHook({
      text: `Password reset and sign-in link emails are paused: the project budget of ${max} emails per hour is used up. Check for abuse, or raise AUTH_RECOVERY_EMAILS_PER_HOUR.`,
    })
  } catch (error) {
    console.error("Recovery email budget alert failed:", error)
  }
}

/**
 * Takes one request from the hourly limit for the caller's network. Call it
 * before the account lookup, so every request counts the same whether or not
 * the address has an account: a caller cannot learn that from its own limit.
 * Returns true when no client IP is known.
 */
export async function takeRecoveryNetworkLimit(
  clientIp: string | undefined,
): Promise<boolean> {
  if (!clientIp) return true
  return consumeAuthRateLimit(
    RECOVERY_EMAIL_IP_LIMIT,
    recoveryClientNetworkKey(clientIp),
  )
}

/**
 * Takes one email from, in order: the caller's own `addressLimit` (if any),
 * the one-minute cooldown for this address, the hourly limit for this
 * account, and the project-wide budget. Call it after
 * takeRecoveryNetworkLimit, so a caller who used up its own limit cannot use
 * up another address's, and after the account lookup and eligibility checks,
 * so requests for addresses with no eligible account do not count. Call it
 * before generateLink, so a refused email does not replace the token in an
 * email already sent.
 */
export async function reserveRecoveryEmail({
  userId,
  email,
  addressLimit,
}: {
  userId: string
  email: string
  addressLimit?: AuthRateLimit
}): Promise<RecoveryEmailReservation> {
  if (
    addressLimit &&
    !(await consumeAuthRateLimit(addressLimit, email.toLowerCase()))
  ) {
    return "address_limit"
  }
  // After the address limit, so a refused request does not start the
  // cooldown shared by both actions.
  if (
    !(await consumeAuthRateLimit(RECOVERY_EMAIL_COOLDOWN, email.toLowerCase()))
  ) {
    return "cooldown"
  }
  if (!(await consumeAuthRateLimit(RECOVERY_EMAIL_ACCOUNT_LIMIT, userId))) {
    return "account_limit"
  }

  const limit = recoveryEmailHourlyLimit()
  for (let attempt = 0; ; attempt++) {
    const outcome = await consumeAuthRateLimitOutcome(limit, PROJECT_KEY)
    if (outcome === "allowed") return "reserved"
    if (outcome === "refused") {
      await reportBudgetUsedUp(limit.max)
      return "budget_used_up"
    }
    if (attempt >= BUSY_RETRY_DELAYS_MS.length) break
    await new Promise((resolve) =>
      setTimeout(resolve, BUSY_RETRY_DELAYS_MS[attempt]),
    )
  }
  console.error("Recovery email budget stayed busy; email not sent")
  return "budget_busy"
}
