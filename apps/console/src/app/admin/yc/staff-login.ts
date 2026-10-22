"use server"

import { randomUUID } from "node:crypto"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createServerClient } from "@/lib/supabase/server"
import { signProof } from "@/lib/yc/signed-proof"
import {
  STAFF_INIT_COOKIE,
  STAFF_SESSION_COOKIE,
  staffCookieOptions,
} from "@/lib/yc/staff-session"

import { staffLoginSession, staffReviewPath } from "./staff-login-session"

export async function staffSignOut(claim?: string) {
  const destination = staffReviewPath(claim)
  if (process.env.YC_STAFF_UI_ENABLED !== "true") redirect(destination)
  let signedOut = false
  try {
    const client = await createServerClient()
    const { error } = await client.auth.signOut({ scope: "local" })
    signedOut = !error
  } catch {
    console.error("Staff account sign-out failed")
  }
  if (!signedOut) redirect(destination)
  redirect(`/auth/signin?next=${encodeURIComponent(destination)}`)
}

export async function staffGoogleLogin(claim?: string) {
  if (process.env.YC_STAFF_UI_ENABLED !== "true")
    redirect(staffReviewPath(claim))
  // Recheck at submission: the session may change after the page renders.
  const session = await staffLoginSession()
  if (session.kind !== "eligible") redirect(staffReviewPath(claim))
  const { client, user } = session
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "")
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Staff login unavailable")
  const nonce = randomUUID()
  const callback = new URL("/auth/callback", origin)
  callback.searchParams.set("staff_google_nonce", nonce)
  const proof = signProof(
    "yc-staff-google-init",
    { actor: user.id, nonce },
    300,
  )
  const { data, error: loginError } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  })
  if (loginError || !data.url) throw new Error("Staff login unavailable")
  const jar = await cookies()
  jar.delete(STAFF_SESSION_COOKIE)
  jar.set(STAFF_INIT_COOKIE, proof, { ...staffCookieOptions, maxAge: 300 })
  redirect(data.url)
}
