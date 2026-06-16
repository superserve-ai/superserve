import crypto from "node:crypto"

import { getProxySecret } from "@/lib/api/proxy-auth"

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
