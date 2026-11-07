import crypto from "node:crypto"

import { cookies } from "next/headers"

const COOKIE_NAME = "__Host-superserve-signup-resend"
const PURPOSE = "signup_resend_v1"
const TTL_SECONDS = 60 * 60
const MAX_COOKIE_LENGTH = 3072

/**
 * What this browser needs to send the same signup confirmation again. The
 * resend action takes no email address, so it cannot be used to probe which
 * accounts exist.
 */
export type SignupResendTicket = {
  user: string
  type: "signup" | "magiclink"
  redirect: string
  attempt: string
  device?: string
}

type SignedTicket = SignupResendTicket & { v: 1; exp: number }

function secret(): string {
  const value = process.env.GOOGLE_SIGNUP_PROOF_SECRET
  if (!value || value.length < 32)
    throw new Error("Signup resend signing secret unavailable")
  return value
}

function mac(encoded: string): Buffer {
  return crypto
    .createHmac("sha256", secret())
    .update(`${PURPOSE}:${encoded}`)
    .digest()
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function decode(value?: string): SignupResendTicket | null {
  if (!value || value.length > MAX_COOKIE_LENGTH) return null
  const [encoded, signed, extra] = value.split(".")
  if (!encoded || !signed || extra) return null
  const supplied = Buffer.from(signed, "base64url")
  const expected = mac(encoded)
  if (
    supplied.toString("base64url") !== signed ||
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  )
    return null
  const data: unknown = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  )
  if (!data || typeof data !== "object") return null
  const ticket = data as Partial<SignedTicket>
  const now = Math.floor(Date.now() / 1000)
  if (
    ticket.v !== 1 ||
    !nonEmpty(ticket.user) ||
    (ticket.type !== "signup" && ticket.type !== "magiclink") ||
    !nonEmpty(ticket.redirect) ||
    !nonEmpty(ticket.attempt) ||
    (ticket.device !== undefined && !nonEmpty(ticket.device)) ||
    typeof ticket.exp !== "number" ||
    ticket.exp < now ||
    ticket.exp > now + TTL_SECONDS
  )
    return null
  return {
    user: ticket.user,
    type: ticket.type,
    redirect: ticket.redirect,
    attempt: ticket.attempt,
    ...(ticket.device ? { device: ticket.device } : {}),
  }
}

/** Returns false when the ticket cannot be stored; signup still succeeds. */
export async function saveSignupResendTicket(
  ticket: SignupResendTicket,
): Promise<boolean> {
  try {
    const signed: SignedTicket = {
      v: 1,
      ...ticket,
      exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    }
    const encoded = Buffer.from(JSON.stringify(signed)).toString("base64url")
    const value = `${encoded}.${mac(encoded).toString("base64url")}`
    if (value.length > MAX_COOKIE_LENGTH) return false
    ;(await cookies()).set(COOKIE_NAME, value, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: TTL_SECONDS,
    })
    return true
  } catch {
    return false
  }
}

export async function readSignupResendTicket(): Promise<SignupResendTicket | null> {
  try {
    return decode((await cookies()).get(COOKIE_NAME)?.value)
  } catch {
    return null
  }
}

export async function clearSignupResendTicket(): Promise<void> {
  try {
    ;(await cookies()).set(COOKIE_NAME, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    })
  } catch {
    // The signed expiry also bounds the ticket.
  }
}
