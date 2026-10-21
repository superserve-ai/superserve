import "server-only"
import type { Session, User } from "@supabase/supabase-js"
import { cookies } from "next/headers"

import { isStaff } from "@/lib/admin/staff"
import { createServerClient } from "@/lib/supabase/server"

import { readProof, signProof } from "./signed-proof"

export const STAFF_INIT_COOKIE = "__Host-yc-staff-init"
export const STAFF_SESSION_COOKIE = "__Host-yc-staff-session"
export const STAFF_PROOF_SECONDS = 15 * 60
export const staffCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
}

function googleIdentity(user: User, subject: unknown) {
  return user.identities?.some(
    (identity) =>
      identity.provider === "google" &&
      identity.identity_data?.sub === subject &&
      identity.identity_data?.email_verified === true &&
      typeof identity.identity_data?.email === "string" &&
      identity.identity_data.email.toLowerCase() === user.email?.toLowerCase(),
  )
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
    const client = await createServerClient()
    const { data, error } = await client.auth.getClaims(session.access_token)
    if (
      error ||
      data?.claims.sub !== user.id ||
      typeof data.claims.session_id !== "string"
    )
      return null
    const response = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${session.provider_token}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!response.ok) return null
    const identity = await response.json()
    if (
      typeof identity.sub !== "string" ||
      identity.email_verified !== true ||
      typeof identity.email !== "string" ||
      identity.email.toLowerCase() !== user.email?.toLowerCase() ||
      !googleIdentity(user, identity.sub)
    )
      return null
    return signProof(
      "yc-staff-google-session",
      { actor: user.id, session: data.claims.session_id, google: identity.sub },
      STAFF_PROOF_SECONDS,
    )
  } catch {
    return null
  }
}

export async function verifyStaffSession(
  user: User,
  sessionId: unknown,
): Promise<void> {
  const proof = readProof(
    (await cookies()).get(STAFF_SESSION_COOKIE)?.value,
    "yc-staff-google-session",
    STAFF_PROOF_SECONDS,
  )
  if (
    typeof sessionId !== "string" ||
    proof.actor !== user.id ||
    proof.session !== sessionId ||
    !googleIdentity(user, proof.google)
  )
    throw new Error("Reauthentication required")
}
