"use server"

import { randomUUID } from "node:crypto"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { isStaff } from "@/lib/admin/staff"
import { createServerClient } from "@/lib/supabase/server"
import { signProof } from "@/lib/yc/signed-proof"
import {
  STAFF_INIT_COOKIE,
  STAFF_SESSION_COOKIE,
  staffCookieOptions,
} from "@/lib/yc/staff-session"

export async function staffGoogleLogin() {
  if (process.env.YC_STAFF_UI_ENABLED !== "true")
    throw new Error("Staff review unavailable")
  const client = await createServerClient()
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (error || !user || !isStaff(user) || (await getImpersonationContext(user)))
    throw new Error("Staff login required")
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
