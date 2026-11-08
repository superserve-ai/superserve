import "server-only"
import { createHash, timingSafeEqual } from "node:crypto"

import { cookies } from "next/headers"

import { isInviteToken } from "@/lib/auth/invite-return-path"

// Marks that this browser started sign-up or sign-in from a specific invite
// page. Only that intent lets a teamless account join without a click, so a
// link opened from elsewhere can never grant ownership by itself. The cookie
// holds a hash of the token, never the token.
export const INVITE_INTENT_COOKIE = "ss-invite-intent"
const INTENT_MAX_AGE_SECONDS = 60 * 60 * 24

function intentValue(token: string): string {
  return createHash("sha256").update(`invite-intent:${token}`).digest("hex")
}

export async function setInviteIntent(token: string): Promise<void> {
  if (!isInviteToken(token)) return
  const store = await cookies()
  store.set(INVITE_INTENT_COOKIE, intentValue(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: INTENT_MAX_AGE_SECONDS,
  })
}

export async function hasInviteIntent(token: string): Promise<boolean> {
  if (!isInviteToken(token)) return false
  const store = await cookies()
  const held = store.get(INVITE_INTENT_COOKIE)?.value
  if (!held) return false
  const expected = Buffer.from(intentValue(token))
  const actual = Buffer.from(held)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function clearInviteIntent(): Promise<void> {
  const store = await cookies()
  store.delete(INVITE_INTENT_COOKIE)
}
