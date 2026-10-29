import "server-only"
import type { Session, User } from "@supabase/supabase-js"
import { cookies } from "next/headers"

import { createServerClient } from "@/lib/supabase/server"
import { readProof, signProof } from "@/lib/yc/signed-proof"

export const PRIVILEGED_GOOGLE_SESSION_COOKIE = "__Host-yc-staff-session"
export const PRIVILEGED_GOOGLE_SESSION_PURPOSE = "yc-staff-google-session"
export const PRIVILEGED_GOOGLE_SESSION_SECONDS = 15 * 60

function googleIdentity(user: User, subject: unknown): boolean {
  return (
    user.identities?.some(
      (identity) =>
        identity.provider === "google" &&
        identity.identity_data?.sub === subject &&
        identity.identity_data?.email_verified === true &&
        typeof identity.identity_data?.email === "string" &&
        identity.identity_data.email.toLowerCase() ===
          user.email?.toLowerCase(),
    ) ?? false
  )
}

/**
 * Issues a short-lived proof only from the server-side OAuth code exchange.
 * The proof is bound to the exact Supabase session and verified Google subject;
 * linked-provider metadata is never sufficient to mint it.
 */
export async function issuePrivilegedGoogleProof(
  session: Session | null,
  user: User,
): Promise<string | null> {
  if (!session?.provider_token || session.user?.id !== user.id) return null

  try {
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
      PRIVILEGED_GOOGLE_SESSION_PURPOSE,
      {
        actor: user.id,
        session: data.claims.session_id,
        google: identity.sub,
        email: identity.email.toLowerCase(),
      },
      PRIVILEGED_GOOGLE_SESSION_SECONDS,
    )
  } catch {
    return null
  }
}

export async function verifyPrivilegedGoogleProof(
  user: User,
  sessionId: unknown,
): Promise<boolean> {
  try {
    const raw = (await cookies()).get(PRIVILEGED_GOOGLE_SESSION_COOKIE)?.value
    const proof = readProof(
      raw,
      PRIVILEGED_GOOGLE_SESSION_PURPOSE,
      PRIVILEGED_GOOGLE_SESSION_SECONDS,
    )
    return (
      typeof sessionId === "string" &&
      proof.actor === user.id &&
      proof.session === sessionId &&
      typeof proof.email === "string" &&
      proof.email.toLowerCase() === user.email?.toLowerCase() &&
      googleIdentity(user, proof.google)
    )
  } catch {
    return false
  }
}

/** Checks the current Supabase session and its bound Google proof. */
export async function hasPrivilegedGoogleSession(
  user: User | null | undefined,
): Promise<boolean> {
  if (!user || user.is_anonymous) return false
  try {
    const client = await createServerClient()
    const { data, error } = await client.auth.getClaims()
    if (
      error ||
      data?.claims.sub !== user.id ||
      typeof data.claims.session_id !== "string"
    )
      return false
    return verifyPrivilegedGoogleProof(user, data.claims.session_id)
  } catch {
    return false
  }
}
