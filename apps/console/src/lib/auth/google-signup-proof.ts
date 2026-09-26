import crypto from "node:crypto"

import { cookies } from "next/headers"

import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"

const COOKIE_NAME = "__Host-superserve-google-signup"
const PURPOSE = "signup_google"
const LEGACY_VERSION = 1
const VERSION = 2
const TTL_SECONDS = 5 * 60
const MAX_PROOF_COOKIES = 4
const MAX_PROOF_COOKIE_BYTES = 3800
const MAX_REQUEST_COOKIES = 128
const PENDING_ATTEMPT_COOKIE = "__Host-superserve-google-signup-attempt"

export class GoogleSignupRecoveryRequiredError extends Error {
  constructor() {
    super("Complete signup with Google to continue.")
    this.name = "GoogleSignupRecoveryRequiredError"
  }
}

interface ProofPayload {
  v: number
  purpose: string
  exp: number
  issued_at?: number
  signup_attempt_id?: string
  actor?: string
}

function cookieName(signupAttemptId?: string): string {
  return signupAttemptId ? `${COOKIE_NAME}-${signupAttemptId}` : COOKIE_NAME
}

function expireCookie(
  store: Awaited<ReturnType<typeof cookies>>,
  name: string,
): void {
  store.set(name, "", { httpOnly: true, secure: true, path: "/", maxAge: 0 })
}

// Bound application scans (including malformed/legacy inputs) before signature work.
// Cookie parsing itself is owned by Next and the server's request-header limits.
function proofCookies(store: Awaited<ReturnType<typeof cookies>>) {
  const entries = "getAll" in store ? store.getAll() : []
  if (entries.length > MAX_REQUEST_COOKIES)
    throw new Error("Too many cookies for Google signup verification")
  const proofs = entries.filter(
    ({ name }) =>
      name !== PENDING_ATTEMPT_COOKIE &&
      (name === COOKIE_NAME || name.startsWith(`${COOKIE_NAME}-`)),
  )
  const legacy = store.get(COOKIE_NAME)
  if (legacy && !proofs.some(({ name }) => name === COOKIE_NAME))
    proofs.push({ name: COOKIE_NAME, value: legacy.value })
  return proofs
}

function signingSecret(): string {
  const secret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("Google signup proof signing secret is not configured")
  }
  return secret
}

function signature(payload: string): Buffer {
  return crypto.createHmac("sha256", signingSecret()).update(payload).digest()
}

function encodeProof(signupAttemptId?: string): string {
  const payload: ProofPayload = {
    v: VERSION,
    purpose: PURPOSE,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    ...(signupAttemptId ? { signup_attempt_id: signupAttemptId } : {}),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${encoded}.${signature(encoded).toString("base64url")}`
}

function validProof(
  value: string | undefined,
  expectedSignupAttemptId?: string,
  requireUnscoped = false,
  expectedActor?: string,
): boolean {
  if (
    !value ||
    Buffer.byteLength(cookieName(expectedSignupAttemptId)) +
      Buffer.byteLength(value) >
      MAX_PROOF_COOKIE_BYTES
  )
    return false
  const [encoded, supplied, extra] = value.split(".")
  if (!encoded || !supplied || extra) return false

  let suppliedSignature: Buffer
  try {
    suppliedSignature = Buffer.from(supplied, "base64url")
  } catch {
    return false
  }

  // Node's base64url decoder accepts non-canonical trailing bits, so a
  // one-character mutation can otherwise decode to the same signature.
  if (suppliedSignature.toString("base64url") !== supplied) return false

  const expected = signature(encoded)
  if (
    suppliedSignature.length !== expected.length ||
    !crypto.timingSafeEqual(suppliedSignature, expected)
  ) {
    return false
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<ProofPayload>
    return (
      (payload.v === VERSION || payload.v === LEGACY_VERSION) &&
      payload.purpose === PURPOSE &&
      typeof payload.exp === "number" &&
      payload.exp >= Math.floor(Date.now() / 1000) &&
      (expectedSignupAttemptId === undefined ||
        (typeof expectedSignupAttemptId === "string" &&
          expectedSignupAttemptId.length > 0 &&
          payload.signup_attempt_id === expectedSignupAttemptId)) &&
      (!requireUnscoped || payload.signup_attempt_id === undefined) &&
      (expectedActor === undefined || payload.actor === expectedActor)
    )
  } catch {
    return false
  }
}

function proofBelongsToActorOrUnbound(
  value: string | undefined,
  attemptId: string | undefined,
  actor: string,
): boolean {
  if (!validProof(value, attemptId, !attemptId)) return false
  const payload = JSON.parse(
    Buffer.from(value!.split(".")[0], "base64url").toString("utf8"),
  ) as ProofPayload
  return payload.actor === undefined || payload.actor === actor
}

function decodedProof(name: string, value: string): ProofPayload | undefined {
  const attemptId =
    name === COOKIE_NAME ? undefined : name.slice(COOKIE_NAME.length + 1)
  if (
    Buffer.byteLength(name) + Buffer.byteLength(value) >
      MAX_PROOF_COOKIE_BYTES ||
    !validProof(value, attemptId)
  )
    return undefined
  return JSON.parse(
    Buffer.from(value.split(".")[0], "base64url").toString("utf8"),
  ) as ProofPayload
}

function unboundProof(name: string, value: string | undefined): boolean {
  if (!value) return false
  const proof = decodedProof(name, value)
  return proof !== undefined && proof.actor === undefined
}

function writeProof(
  store: Awaited<ReturnType<typeof cookies>>,
  name: string,
  payload: ProofPayload,
) {
  // Drop any legacy visitor fields while retaining the independent CAPTCHA proof.
  const proof: ProofPayload = {
    v: payload.v,
    purpose: payload.purpose,
    exp: payload.exp,
    issued_at: payload.issued_at,
    signup_attempt_id: payload.signup_attempt_id,
    actor: payload.actor,
  }
  const encoded = Buffer.from(JSON.stringify(proof)).toString("base64url")
  const value = `${encoded}.${signature(encoded).toString("base64url")}`
  if (
    name === PENDING_ATTEMPT_COOKIE ||
    Buffer.byteLength(name) + Buffer.byteLength(value) > MAX_PROOF_COOKIE_BYTES
  )
    throw new Error("Google signup proof is too large or has an invalid name")
  const entries = proofCookies(store)
  const pendingName = cookieName(store.get(PENDING_ATTEMPT_COOKIE)?.value)
  const retained = entries
    .filter((entry) => entry.name !== name)
    .map((entry) => ({
      name: entry.name,
      proof: decodedProof(entry.name, entry.value),
    }))
    .filter((entry) => entry.proof !== undefined)
    .toSorted(
      (a, b) =>
        Number(b.name === pendingName) - Number(a.name === pendingName) ||
        (b.proof!.issued_at ?? (b.proof!.exp - TTL_SECONDS) * 1000) -
          (a.proof!.issued_at ?? (a.proof!.exp - TTL_SECONDS) * 1000) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_PROOF_COOKIES - 1)
  const keep = new Set([name, ...retained.map((entry) => entry.name)])
  for (const entry of entries)
    if (!keep.has(entry.name)) expireCookie(store, entry.name)
  store.set(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
  })
}

export async function issueGoogleSignupProof(
  signupAttemptId?: string,
): Promise<void> {
  const store = await cookies()
  const name = cookieName(signupAttemptId)
  if (
    name === PENDING_ATTEMPT_COOKIE ||
    Buffer.byteLength(name) > MAX_PROOF_COOKIE_BYTES
  )
    throw new Error("Invalid Google signup attempt")
  const entries = proofCookies(store)
  const existing = store.get(name)?.value
  const payload = existing && decodedProof(name, existing)
  const fresh = payload || decodedProof(name, encodeProof(signupAttemptId))
  if (!fresh) throw new Error("Google signup proof is too large")
  writeProof(
    store,
    name,
    payload || {
      ...fresh,
      issued_at: Math.max(
        Date.now(),
        ...entries.map(
          (entry) =>
            (decodedProof(entry.name, entry.value)?.issued_at ?? 0) + 1,
        ),
      ),
    },
  )
}

export async function hasValidGoogleSignupProof(
  expectedSignupAttemptId?: string,
): Promise<boolean> {
  try {
    const store = await cookies()
    if (expectedSignupAttemptId !== undefined) {
      return (
        validProof(
          store.get(cookieName(expectedSignupAttemptId))?.value,
          expectedSignupAttemptId,
        ) || validProof(store.get(COOKIE_NAME)?.value, expectedSignupAttemptId)
      )
    }

    const allCookies = proofCookies(store)
    return (
      validProof(store.get(COOKIE_NAME)?.value) ||
      allCookies.some(({ name, value }) => {
        if (!name.startsWith(`${COOKIE_NAME}-`)) return false
        const signupAttemptId = name.slice(`${COOKIE_NAME}-`.length)
        return validProof(value, signupAttemptId)
      })
    )
  } catch (error) {
    console.error("Google signup proof validation failed", error)
    return false
  }
}

/** Compatibility-only check for proofs issued before attempt-scoped cookies. */
export async function hasValidLegacyGoogleSignupProof(): Promise<boolean> {
  try {
    const store = await cookies()
    return validProof(store.get(COOKIE_NAME)?.value, undefined, true)
  } catch {
    return false
  }
}

export async function markGoogleSignupAttempt(
  signupAttemptId: string | undefined,
  actor: string,
): Promise<void> {
  const store = await cookies()
  const name = cookieName(signupAttemptId)
  const scoped = store.get(name)?.value
  const legacy = signupAttemptId ? store.get(COOKIE_NAME)?.value : undefined
  const value = validProof(scoped, signupAttemptId, !signupAttemptId)
    ? scoped
    : legacy
  if (!actor || !validProof(value, signupAttemptId, !signupAttemptId))
    throw new Error("Google signup verification required")
  const payload = JSON.parse(
    Buffer.from(value!.split(".")[0], "base64url").toString("utf8"),
  ) as ProofPayload
  if (payload.actor && payload.actor !== actor)
    throw new Error("Google signup verification required")
  const maxAge = Math.max(0, payload.exp - Math.floor(Date.now() / 1000))
  writeProof(store, name, { ...payload, v: VERSION, actor })
  if (signupAttemptId && value === legacy) expireCookie(store, COOKIE_NAME)
  if (signupAttemptId)
    store.set(PENDING_ATTEMPT_COOKIE, signupAttemptId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge,
    })
}

export async function revokeGoogleSignupAuthorization(
  actor: string,
  failedAttemptId?: string,
): Promise<void> {
  const store = await cookies()
  const pendingAttemptId = store.get(PENDING_ATTEMPT_COOKIE)?.value
  const failedName = cookieName(failedAttemptId)
  const failedValue = store.get(failedName)?.value
  const removeFailed = proofBelongsToActorOrUnbound(
    failedValue,
    failedAttemptId,
    actor,
  )
  let clearPending = removeFailed && pendingAttemptId === failedAttemptId
  if (removeFailed) expireCookie(store, failedName)
  for (const { name, value } of proofCookies(store)) {
    if (name === COOKIE_NAME) {
      if (
        validProof(value, undefined, true, actor) ||
        (failedAttemptId &&
          proofBelongsToActorOrUnbound(value, failedAttemptId, actor))
      )
        expireCookie(store, name)
      continue
    }
    if (!name.startsWith(`${COOKIE_NAME}-`)) continue
    const attemptId = name.slice(COOKIE_NAME.length + 1)
    if (validProof(value, attemptId, false, actor)) {
      expireCookie(store, name)
      if (pendingAttemptId === attemptId) clearPending = true
    }
  }
  if (clearPending) expireCookie(store, PENDING_ATTEMPT_COOKIE)
}

export async function readGoogleSignupAttempt(): Promise<string | undefined> {
  try {
    return (await cookies()).get(PENDING_ATTEMPT_COOKIE)?.value
  } catch {
    return undefined
  }
}

export async function requireGoogleSignupProof(
  actor: string,
  expectedSignupAttemptId?: string,
): Promise<string | undefined> {
  try {
    const store = await cookies()
    expectedSignupAttemptId ||= store.get(PENDING_ATTEMPT_COOKIE)?.value
    let matchedAttemptId: string | undefined
    if (expectedSignupAttemptId) {
      const pendingProof = store.get(cookieName(expectedSignupAttemptId))?.value
      if (validProof(pendingProof, expectedSignupAttemptId, false, actor))
        return expectedSignupAttemptId
      if (unboundProof(cookieName(expectedSignupAttemptId), pendingProof))
        throw new GoogleSignupRecoveryRequiredError()
      // Do not let an abandoned callback pin future provisioning to a stale attempt.
      if (!validProof(pendingProof, expectedSignupAttemptId))
        expireCookie(store, PENDING_ATTEMPT_COOKIE)
    }

    // Resolve the exact proof that authorized this provisioning request so the
    // caller can consume that same cookie. Provider attempts are independent;
    // never discard the correlation key after validation.
    const validUnscoped = validProof(
      store.get(COOKIE_NAME)?.value,
      undefined,
      true,
      actor,
    )
    if ("getAll" in store) {
      const allCookies = proofCookies(store)
      const scopedProof = allCookies.find(({ name, value }) => {
        if (!name.startsWith(`${COOKIE_NAME}-`)) return false
        const attemptId = name.slice(`${COOKIE_NAME}-`.length)
        if (!attemptId) return false
        if (!validProof(value, attemptId, false, actor)) return false
        matchedAttemptId = attemptId
        return true
      })
      if (validUnscoped || scopedProof) return matchedAttemptId
    } else if (validUnscoped) {
      return undefined
    }
  } catch (error) {
    if (error instanceof GoogleSignupRecoveryRequiredError) throw error
    // Treat cookie-store/configuration failures as a missing proof below.
  }
  await trackGoogleSignupBypass()
  throw new Error("Google signup verification required")
}

async function trackGoogleSignupBypass(): Promise<void> {
  await trackEvent(
    AUTH_EVENTS.GOOGLE_SIGNUP_BYPASS_BLOCKED,
    crypto.randomUUID(),
    { reason: "missing_or_invalid_proof", scope: "first_team_provisioning" },
  )
  console.warn("Google signup onboarding blocked: missing or invalid proof")
}

export async function consumeGoogleSignupProof(
  distinctId: string = crypto.randomUUID(),
  signupAttemptId?: string,
): Promise<void> {
  const store = await cookies()
  if (signupAttemptId) {
    expireCookie(store, cookieName(signupAttemptId))
    expireCookie(store, PENDING_ATTEMPT_COOKIE)
  } else if ("getAll" in store) {
    const allCookies = proofCookies(store)
    // Legacy, unscoped proofs have no attempt ID; consume only that proof.
    if (allCookies.some(({ name }) => name === COOKIE_NAME)) {
      expireCookie(store, COOKIE_NAME)
    } else {
      // Preserve other concurrent attempts. For legacy callers without an ID,
      // consume at most one valid attempt-scoped proof rather than all of them.
      const proofCookie = allCookies.find(({ name, value }) => {
        if (!name.startsWith(`${COOKIE_NAME}-`)) return false
        const attemptId = name.slice(`${COOKIE_NAME}-`.length)
        return validProof(value, attemptId)
      })
      if (proofCookie) expireCookie(store, proofCookie.name)
    }
  } else {
    // Keep compatibility with cookie-store implementations that predate getAll.
    const legacyStore = store as unknown as {
      get(name: string): { value: string } | undefined
    }
    if (legacyStore.get(COOKIE_NAME)) {
      expireCookie(store, COOKIE_NAME)
    }
  }
  await trackEvent(AUTH_EVENTS.GOOGLE_SIGNUP_PROOF_CONSUMED, distinctId, {
    scope: "first_team_provisioning",
  })
  console.info("Google signup proof consumed after first team provisioning")
}

export function isGoogleUser(user: {
  app_metadata?: { provider?: string; providers?: string[] }
}): boolean {
  return (
    user.app_metadata?.provider === "google" ||
    user.app_metadata?.providers?.includes("google") === true
  )
}
