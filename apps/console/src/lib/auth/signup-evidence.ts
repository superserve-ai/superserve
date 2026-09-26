import crypto from "node:crypto"

import { cookies } from "next/headers"

const COOKIE_NAME = "__Host-superserve-signup-evidence"
const TTL_SECONDS = 600

type Evidence = {
  v: 1
  attempt: string
  actor?: string
  event?: string
  visitor?: string
  exp: number
}

export type SignupEvidenceEntry = {
  attempt: string
  visitor: string
  value: string
}

function secret(): string {
  const value = process.env.GOOGLE_SIGNUP_PROOF_SECRET
  if (!value || value.length < 32)
    throw new Error("Signup evidence signing secret unavailable")
  return value
}

function mac(encoded: string): Buffer {
  return crypto.createHmac("sha256", secret()).update(encoded).digest()
}

function encode(evidence: Evidence): string {
  const encoded = Buffer.from(JSON.stringify(evidence)).toString("base64url")
  return `${encoded}.${mac(encoded).toString("base64url")}`
}

function decode(value?: string): Evidence | null {
  if (!value || value.length > 2048) return null
  const [encoded, signed, extra] = value.split(".")
  if (!encoded || !signed || extra) return null
  const supplied = Buffer.from(signed, "base64url")
  const expected = mac(encoded)
  if (
    supplied.toString("base64url") !== signed ||
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  )
    return null
  const data: unknown = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  )
  if (!data || typeof data !== "object") return null
  const evidence = data as Partial<Evidence>
  const now = Math.floor(Date.now() / 1000)
  if (
    evidence.v !== 1 ||
    typeof evidence.attempt !== "string" ||
    !evidence.attempt ||
    (evidence.actor !== undefined &&
      (typeof evidence.actor !== "string" || !evidence.actor)) ||
    (evidence.event !== undefined &&
      (typeof evidence.event !== "string" || !evidence.event)) ||
    (evidence.visitor !== undefined &&
      (typeof evidence.visitor !== "string" ||
        !evidence.visitor ||
        Buffer.byteLength(evidence.visitor) > 256)) ||
    (evidence.visitor !== undefined && (!evidence.actor || !evidence.event)) ||
    typeof evidence.exp !== "number" ||
    evidence.exp < now ||
    evidence.exp > now + TTL_SECONDS
  )
    return null
  return evidence as Evidence
}

async function set(value: string, maxAge: number): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  })
}

/** A new browser attempt supersedes the previous one, even before lookup. */
export async function beginSignupEvidenceAttempt(
  attempt: string,
): Promise<boolean> {
  if (!attempt) return false
  try {
    await set(
      encode({
        v: 1,
        attempt,
        exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      }),
      TTL_SECONDS,
    )
    return true
  } catch {
    // Fingerprint evidence is optional.
    return false
  }
}

export async function saveSignupEvidence(
  actor: string,
  attempt: string,
  event: string,
  visitor: string,
): Promise<void> {
  if (
    !actor ||
    !attempt ||
    !event ||
    !visitor ||
    Buffer.byteLength(visitor) > 256
  )
    return
  const store = await cookies()
  const current = decode(store.get(COOKIE_NAME)?.value)
  if (
    !current ||
    current.attempt !== attempt ||
    (current.actor && current.actor !== actor)
  )
    return
  // A repeated callback keeps the first verified visitor and original expiry.
  if (current.visitor) return
  await set(
    encode({ ...current, actor, event, visitor }),
    Math.max(0, current.exp - Math.floor(Date.now() / 1000)),
  )
}

export async function readSignupEvidenceEntries(
  actor: string,
  attempt?: string,
): Promise<SignupEvidenceEntry[]> {
  try {
    const value = (await cookies()).get(COOKIE_NAME)?.value
    const evidence = decode(value)
    if (
      !evidence?.visitor ||
      evidence.actor !== actor ||
      (attempt && evidence.attempt !== attempt)
    )
      return []
    return [
      { attempt: evidence.attempt, visitor: evidence.visitor, value: value! },
    ]
  } catch {
    return []
  }
}

export async function readSignupEvidence(
  actor: string,
  attempt?: string,
): Promise<string | null> {
  return (await readSignupEvidenceEntries(actor, attempt))[0]?.visitor ?? null
}

export async function isActiveSignupEvidenceAttempt(
  attempt: string,
): Promise<boolean> {
  try {
    return (
      decode((await cookies()).get(COOKIE_NAME)?.value)?.attempt === attempt
    )
  } catch {
    return false
  }
}

export async function isSupersededSignupEvidenceAttempt(
  attempt: string,
): Promise<boolean> {
  try {
    const current = decode((await cookies()).get(COOKIE_NAME)?.value)
    return current !== null && current.attempt !== attempt
  } catch {
    return false
  }
}

export async function clearEvaluatedSignupEvidence(
  actor: string,
  entries: SignupEvidenceEntry[],
): Promise<void> {
  try {
    const store = await cookies()
    const current = store.get(COOKIE_NAME)?.value
    if (
      !entries.some(
        (entry) =>
          entry.value === current && decode(entry.value)?.actor === actor,
      )
    )
      return
    store.set(COOKIE_NAME, "", {
      httpOnly: true,
      secure: true,
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    })
  } catch {
    // Signed expiry also bounds evidence.
  }
}
