import "server-only"
import type { Session, User } from "@supabase/supabase-js"
import { cookies } from "next/headers"

import {
  issuePrivilegedGoogleProof,
  PRIVILEGED_GOOGLE_SESSION_COOKIE,
  PRIVILEGED_GOOGLE_SESSION_PURPOSE,
  PRIVILEGED_GOOGLE_SESSION_SECONDS,
  verifyPrivilegedGoogleProof,
} from "@/lib/admin/google-session"
import { isStaff } from "@/lib/admin/staff"

import { readProof } from "./signed-proof"

export const STAFF_INIT_COOKIE = "__Host-yc-staff-init"
export const STAFF_SESSION_COOKIE = PRIVILEGED_GOOGLE_SESSION_COOKIE
export const STAFF_PROOF_SECONDS = PRIVILEGED_GOOGLE_SESSION_SECONDS
export const staffCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
}

// Called only with the session returned by the server's PKCE code exchange.
export async function completeStaffGoogle(
  session: Session | null,
  nonce: string | null,
  user: User,
): Promise<string | null> {
  if (process.env.YC_STAFF_UI_ENABLED !== "true" || !nonce) return null
  const jar = await cookies()
  const raw = jar.get(STAFF_INIT_COOKIE)?.value
  jar.delete(STAFF_INIT_COOKIE)
  jar.delete(STAFF_SESSION_COOKIE)
  try {
    const initiation = readProof(raw, "yc-staff-google-init", 300)
    if (
      initiation.nonce !== nonce ||
      initiation.actor !== user.id ||
      !isStaff(user) ||
      !user.email_confirmed_at ||
      !session?.provider_token ||
      session.user.id !== user.id
    )
      return null
    return issuePrivilegedGoogleProof(session, user)
  } catch {
    return null
  }
}

export async function verifyStaffSession(
  user: User,
  sessionId: unknown,
): Promise<void> {
  if (!(await verifyPrivilegedGoogleProof(user, sessionId)))
    throw new Error("Reauthentication required")
}

export { issuePrivilegedGoogleProof, PRIVILEGED_GOOGLE_SESSION_PURPOSE }
