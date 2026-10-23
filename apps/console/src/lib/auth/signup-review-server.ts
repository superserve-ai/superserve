import "server-only"
import { cookies } from "next/headers"

import { createAdminClient } from "@/lib/supabase/admin"

export const PENDING_PROFILE_COOKIE = "ss-signup-pending"

const PENDING_PROFILE_TTL_SECONDS = 24 * 60 * 60

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

export interface PendingProfile {
  name?: string
  email?: string
}

export const pendingProfileCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
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
