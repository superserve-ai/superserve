import crypto from "node:crypto"

import type { User } from "@supabase/supabase-js"
import { cookies } from "next/headers"

import { isStaff } from "@/lib/admin/staff"
import { getProxySecret } from "@/lib/api/proxy-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

export const IMPERSONATION_COOKIE = "ss_impersonate"

const DEFAULT_TTL_MINUTES = 30

export function impersonationTtlMs(): number {
  const mins = Number(
    process.env.IMPERSONATION_TTL_MINUTES ?? DEFAULT_TTL_MINUTES,
  )
  return (
    (Number.isFinite(mins) && mins > 0 ? mins : DEFAULT_TTL_MINUTES) * 60_000
  )
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", getProxySecret())
    .update(payload)
    .digest("base64url")
}

/** Token = `${teamId}.${exp}.${hmac}` — tamper-proof and self-expiring. */
export function signImpersonationToken(teamId: string, exp: number): string {
  const payload = `${teamId}.${exp}`
  return `${payload}.${sign(payload)}`
}

export function verifyImpersonationToken(
  token: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [teamId, expRaw, providedSig] = parts
  const expectedSig = sign(`${teamId}.${expRaw}`)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < now) return null
  return teamId
}

export async function readImpersonationTeamId(): Promise<string | null> {
  const store = await cookies()
  return verifyImpersonationToken(store.get(IMPERSONATION_COOKIE)?.value)
}

/**
 * The team the current request should act as: the target team only when the
 * user is staff AND a valid impersonation cookie is present; otherwise null
 * (callers fall back to the user's own team).
 */
export async function getImpersonationTeamId(
  user: User | null | undefined,
): Promise<string | null> {
  if (!isStaff(user)) return null
  return readImpersonationTeamId()
}

export async function setImpersonationCookie(teamId: string): Promise<void> {
  const store = await cookies()
  const token = signImpersonationToken(
    teamId,
    Date.now() + impersonationTtlMs(),
  )
  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
  store.set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(impersonationTtlMs() / 1000),
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  })
}

export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies()
  store.delete(IMPERSONATION_COOKIE)
}

export interface ImpersonationContext {
  teamId: string
  teamName: string
}

/**
 * Returns the active impersonation context for the current request, or null if
 * the user is not staff or no valid impersonation cookie is present.
 */
export async function getImpersonationContext(): Promise<ImpersonationContext | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const teamId = await getImpersonationTeamId(user)
  if (!teamId) return null

  const admin = createAdminClient()
  const { data: team, error } = await admin
    .from("team")
    .select("name")
    .eq("id", teamId)
    .single()

  if (error || !team) return null
  return { teamId, teamName: team.name as string }
}
