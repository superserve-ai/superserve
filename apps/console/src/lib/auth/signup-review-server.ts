import "server-only"
import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"
import { cookies } from "next/headers"

import { isStaff } from "@/lib/admin/staff"
import { createAdminClient } from "@/lib/supabase/admin"

import {
  parseSignupDetails,
  signupReviewStatus,
  type SignupDetails,
} from "./signup-review"

export const SIGNUP_DETAILS_COOKIE = "__Host-superserve-signup-details"
export const PENDING_PROFILE_COOKIE = "ss-signup-pending"

const DETAILS_PURPOSE = "signup_details_v1"
// Covers the Google consent round trip only; the callback consumes it.
const DETAILS_TTL_SECONDS = 15 * 60
const PENDING_PROFILE_TTL_SECONDS = 24 * 60 * 60
// The callback sees an OAuth account seconds after Auth creates it; anything
// older without a review state is an existing account and passes unchanged.
const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000

/** Merged into app_metadata; Auth keeps keys that are not listed. */
export async function updateSignupReviewMetadata(
  userId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await createAdminClient().auth.admin.updateUserById(
    userId,
    { app_metadata: metadata },
  )
  if (error) throw new Error(`Signup review update failed: ${error.message}`)
}

/**
 * A brand-new OAuth account that has not entered review. Staff (Google on the
 * staff domain) and invited teammates are not signups and skip review.
 */
export function requiresSignupReview(
  user: Pick<User, "app_metadata" | "created_at" | "email"> & {
    invited_at?: string
  },
  now = Date.now(),
): boolean {
  if (signupReviewStatus(user) || user.invited_at) return false
  if (isStaff(user as User)) return false
  const createdAt = Date.parse(user.created_at)
  return Number.isFinite(createdAt) && now - createdAt < NEW_ACCOUNT_WINDOW_MS
}

function secret(): string {
  const value = process.env.GOOGLE_SIGNUP_PROOF_SECRET
  if (!value || value.length < 32)
    throw new Error("Signup details signing secret is not configured")
  return value
}

function sign(encoded: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`${DETAILS_PURPOSE}:${encoded}`)
    .digest("base64url")
}

/** Holds Google signup details across the OAuth redirect, bound to one attempt. */
export async function stashSignupDetails(
  signupAttemptId: string,
  details: SignupDetails,
): Promise<void> {
  const encoded = Buffer.from(
    JSON.stringify({
      attempt: signupAttemptId,
      exp: Math.floor(Date.now() / 1000) + DETAILS_TTL_SECONDS,
      details,
    }),
  ).toString("base64url")
  ;(await cookies()).set(SIGNUP_DETAILS_COOKIE, `${encoded}.${sign(encoded)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: DETAILS_TTL_SECONDS,
  })
}

export async function readStashedSignupDetails(
  signupAttemptId: string | undefined,
): Promise<SignupDetails | undefined> {
  if (!signupAttemptId) return undefined
  try {
    const value = (await cookies()).get(SIGNUP_DETAILS_COOKIE)?.value
    if (!value || value.length > 8192) return undefined
    const [encoded, supplied, extra] = value.split(".")
    if (!encoded || !supplied || extra) return undefined
    const expected = Buffer.from(sign(encoded), "base64url")
    const actual = Buffer.from(supplied, "base64url")
    if (
      actual.toString("base64url") !== supplied ||
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    )
      return undefined
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as { attempt?: unknown; exp?: unknown; details?: unknown }
    if (
      payload.attempt !== signupAttemptId ||
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    )
      return undefined
    const parsed = parseSignupDetails(payload.details)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export interface PendingProfile {
  name?: string
  email?: string
}

export const pendingProfileCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: PENDING_PROFILE_TTL_SECONDS,
}

export function encodePendingProfile(profile: PendingProfile): string {
  return JSON.stringify({
    name: profile.name?.slice(0, 200) || undefined,
    email: profile.email?.slice(0, 320) || undefined,
  })
}

/** Prefill only; the pending page never treats it as identity. */
export async function readPendingProfile(): Promise<PendingProfile> {
  try {
    const value = (await cookies()).get(PENDING_PROFILE_COOKIE)?.value
    if (!value) return {}
    const parsed = JSON.parse(value) as Record<string, unknown>
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
    }
  } catch {
    return {}
  }
}
