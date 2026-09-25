import crypto from "node:crypto"

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

type CookieSet = {
  name: string
  value: string
  options: Record<string, unknown>
}

let cookieValue: string | undefined
const cookieSets: CookieSet[] = []
let cookieEntries: Array<{ name: string; value: string }> = []

const mockTrackEvent = vi.fn()
vi.mock("@/lib/posthog/actions", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
vi.mock("@/lib/posthog/events", () => ({
  AUTH_EVENTS: {
    GOOGLE_SIGNUP_BYPASS_BLOCKED: "auth_google_signup_bypass_blocked",
    GOOGLE_SIGNUP_PROOF_CONSUMED: "auth_google_signup_proof_consumed",
  },
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = cookieEntries.find((cookie) => cookie.name === name)
      if (entry) return entry
      return name === "__Host-superserve-google-signup" &&
        cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined
    },
    getAll: () => cookieEntries,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieSets.push({ name, value, options })
      // A browser rejects an insecure attempt to expire a __Host- cookie.
      if (options.maxAge === 0) {
        if (options.secure !== true || options.path !== "/") return
        if (name === "__Host-superserve-google-signup") cookieValue = undefined
        cookieEntries = cookieEntries.filter((cookie) => cookie.name !== name)
        return
      }
      if (name === "__Host-superserve-google-signup") cookieValue = value
      cookieEntries = [
        ...cookieEntries.filter((cookie) => cookie.name !== name),
        { name, value },
      ]
    },
  }),
}))

function expectSecureExpirations(names: string[]): void {
  expect(cookieSets.filter(({ options }) => options.maxAge === 0)).toEqual(
    names.map((name) => ({
      name,
      value: "",
      options: { httpOnly: true, secure: true, path: "/", maxAge: 0 },
    })),
  )
}

function signProofPayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = crypto
    .createHmac("sha256", process.env.GOOGLE_SIGNUP_PROOF_SECRET ?? "")
    .update(encoded)
    .digest("base64url")
  return `${encoded}.${signature}`
}

import {
  hasValidGoogleSignupProof,
  consumeGoogleSignupProof,
  issueGoogleSignupProof,
  requireGoogleSignupProof,
  markGoogleSignupAttempt,
  revokeGoogleSignupAuthorization,
  hasValidLegacyGoogleSignupProof,
  GoogleSignupRecoveryRequiredError,
} from "./google-signup-proof"

describe("google-signup-proof", () => {
  beforeEach(() => {
    cookieValue = undefined
    cookieSets.length = 0
    cookieEntries = []
    mockTrackEvent.mockReset().mockResolvedValue(undefined)
    process.env.GOOGLE_SIGNUP_PROOF_SECRET = "g".repeat(32)
  })

  afterEach(() => {
    delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
  })

  it("issues a signed HttpOnly proof cookie that validates", async () => {
    await issueGoogleSignupProof()

    expect(cookieSets).toHaveLength(1)
    expect(cookieSets[0]).toMatchObject({
      name: "__Host-superserve-google-signup",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 300,
      },
    })
    expect(cookieSets[0].value).toContain(".")
    expect(await hasValidGoogleSignupProof()).toBe(true)
  })

  it("matches the signed attempt ID when validating callback correlation", async () => {
    await issueGoogleSignupProof("attempt-1")

    expect(await hasValidGoogleSignupProof("attempt-1")).toBe(true)
    expect(await hasValidGoogleSignupProof()).toBe(true)
    expect(await hasValidGoogleSignupProof("attempt-2")).toBe(false)
    expect(await hasValidGoogleSignupProof("")).toBe(false)

    cookieEntries = []
    await issueGoogleSignupProof()
    expect(await hasValidGoogleSignupProof("attempt-1")).toBe(false)
  })

  it("does not treat a scoped proof as a legacy callback proof", async () => {
    await issueGoogleSignupProof("attempt-1")
    cookieValue = undefined
    expect(await hasValidLegacyGoogleSignupProof()).toBe(false)
  })

  it("validates an active attempt-scoped proof for provisioning without an ID", async () => {
    await issueGoogleSignupProof("attempt-1")

    expect(await hasValidGoogleSignupProof()).toBe(true)
  })

  it("binds provisioning to the callback-selected concurrent attempt", async () => {
    await issueGoogleSignupProof("attempt-b")
    await issueGoogleSignupProof("attempt-a")
    await markGoogleSignupAttempt("attempt-a", "user-123")

    expect(await requireGoogleSignupProof("user-123")).toBe("attempt-a")
    await expect(requireGoogleSignupProof("another-user")).rejects.toThrow(
      "Google signup verification required",
    )
    await consumeGoogleSignupProof("user-123", "attempt-a")
    expect(await hasValidGoogleSignupProof("attempt-b")).toBe(true)
  })

  it("bounds overlapping proofs while preserving the selected and newest attempts", async () => {
    await issueGoogleSignupProof("attempt-a")
    await markGoogleSignupAttempt("attempt-a", "user-123")
    for (const attemptId of ["b", "c", "d", "e", "f", "g"])
      await issueGoogleSignupProof(`attempt-${attemptId}`)

    expect(
      cookieEntries.filter(
        ({ name }) => name !== "__Host-superserve-google-signup-attempt",
      ),
    ).toHaveLength(4)
    expect(await requireGoogleSignupProof("user-123")).toBe("attempt-a")
    expect(await requireGoogleSignupProof("user-123")).toBe("attempt-a")
    for (const attempt of ["a", "e", "f", "g"])
      expect(await hasValidGoogleSignupProof(`attempt-${attempt}`)).toBe(true)
    for (const attempt of ["b", "c", "d"])
      expect(await hasValidGoogleSignupProof(`attempt-${attempt}`)).toBe(false)
    await consumeGoogleSignupProof("user-123", "attempt-a")
    expect(await hasValidGoogleSignupProof("attempt-g")).toBe(true)
  })

  it("prunes malformed and expired proofs without touching other cookies", async () => {
    cookieEntries = [
      { name: "session", value: "session" },
      { name: "__Host-superserve-google-signup-invalid", value: "invalid" },
      {
        name: "__Host-superserve-google-signup-expired",
        value: signProofPayload({
          v: 2,
          purpose: "signup_google",
          exp: 1,
          signup_attempt_id: "expired",
        }),
      },
    ]
    await issueGoogleSignupProof("new")
    expect(cookieEntries.map(({ name }) => name)).toEqual([
      "session",
      "__Host-superserve-google-signup-new",
    ])
  })

  it("rejects oversized issuance and actor binding before mutating cookies", async () => {
    await expect(issueGoogleSignupProof("x".repeat(3000))).rejects.toThrow()
    expect(cookieSets).toEqual([])
    await issueGoogleSignupProof("active")
    const before = [...cookieEntries]
    await expect(
      markGoogleSignupAttempt("active", "x".repeat(4000)),
    ).rejects.toThrow()
    expect(cookieEntries).toEqual(before)
    expect(
      cookieEntries.every(
        ({ name, value }) =>
          Buffer.byteLength(name) + Buffer.byteLength(value) <= 3800,
      ),
    ).toBe(true)
  })

  it("bounds fallback scans for excessive cookie inputs while direct selection works", async () => {
    await issueGoogleSignupProof("active")
    await markGoogleSignupAttempt("active", "user-123")
    cookieEntries.push(
      ...Array.from({ length: 129 }, (_, i) => ({
        name: `unrelated-${i}`,
        value: "value",
      })),
    )
    expect(await hasValidGoogleSignupProof()).toBe(false)
    expect(await hasValidGoogleSignupProof("active")).toBe(true)
    expect(await requireGoogleSignupProof("user-123", "active")).toBe("active")
    const before = [...cookieEntries]
    await expect(issueGoogleSignupProof("new")).rejects.toThrow(
      "Too many cookies",
    )
    expect(cookieEntries).toEqual(before)
  })

  it("keeps a pre-auth proof unusable until callback promotion and preserves its expiry", async () => {
    await issueGoogleSignupProof("attempt-a")
    await expect(requireGoogleSignupProof("user-123")).rejects.toThrow(
      "Google signup verification required",
    )
    const issuedAt = Date.now()
    vi.useFakeTimers()
    try {
      vi.setSystemTime(issuedAt + 100_000)
      await markGoogleSignupAttempt("attempt-a", "user-123")
      expect(await requireGoogleSignupProof("user-123")).toBe("attempt-a")
      expect(cookieSets.at(-2)?.options.maxAge).toBeLessThanOrEqual(200)
      vi.setSystemTime(issuedAt + 301_000)
      expect(await hasValidGoogleSignupProof("attempt-a")).toBe(false)
      await expect(requireGoogleSignupProof("user-123")).rejects.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it("requires callback promotion before a v1 proof can authorize provisioning", async () => {
    const now = Date.now()
    vi.useFakeTimers()
    try {
      vi.setSystemTime(now)
      const proof = signProofPayload({
        v: 1,
        purpose: "signup_google",
        exp: Math.floor(now / 1000) + 300,
        signup_attempt_id: "attempt-before-deploy",
      })
      cookieEntries = [
        {
          name: "__Host-superserve-google-signup-attempt-before-deploy",
          value: proof,
        },
        {
          name: "__Host-superserve-google-signup-attempt",
          value: "attempt-before-deploy",
        },
      ]

      await expect(requireGoogleSignupProof("user-123")).rejects.toBeInstanceOf(
        GoogleSignupRecoveryRequiredError,
      )
      await markGoogleSignupAttempt("attempt-before-deploy", "user-123")
      expect(await requireGoogleSignupProof("user-123")).toBe(
        "attempt-before-deploy",
      )
      // Verification alone leaves the proof available for a provisioning retry.
      expect(await requireGoogleSignupProof("user-123")).toBe(
        "attempt-before-deploy",
      )
      await consumeGoogleSignupProof("user-123", "attempt-before-deploy")
      expect(cookieEntries).toEqual([])
      await expect(requireGoogleSignupProof("user-123")).rejects.toThrow(
        "Google signup verification required",
      )

      cookieEntries = [
        {
          name: "__Host-superserve-google-signup-attempt-before-deploy",
          value: proof,
        },
      ]
      vi.setSystemTime(now + 301_000)
      await expect(requireGoogleSignupProof("user-123")).rejects.toThrow(
        "Google signup verification required",
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("offers fresh Google verification when deployment follows the callback but precedes provisioning", async () => {
    const attemptId = "attempt-before-deploy"
    cookieEntries = [
      {
        name: `__Host-superserve-google-signup-${attemptId}`,
        value: signProofPayload({
          v: 1,
          purpose: "signup_google",
          exp: Math.floor(Date.now() / 1000) + 300,
          signup_attempt_id: attemptId,
        }),
      },
      {
        name: "__Host-superserve-google-signup-attempt",
        value: attemptId,
      },
    ]

    await expect(requireGoogleSignupProof("user-123")).rejects.toBeInstanceOf(
      GoogleSignupRecoveryRequiredError,
    )
    expect(cookieSets).toEqual([])
    await expect(
      requireGoogleSignupProof("another-user"),
    ).rejects.toBeInstanceOf(GoogleSignupRecoveryRequiredError)
    await issueGoogleSignupProof("fresh-attempt")
    await markGoogleSignupAttempt("fresh-attempt", "user-123")
    expect(await requireGoogleSignupProof("user-123")).toBe("fresh-attempt")
    await expect(requireGoogleSignupProof("another-user")).rejects.toThrow(
      "Google signup verification required",
    )
  })

  it("rejects an unbound proof even when an unsigned attempt marker matches", async () => {
    await issueGoogleSignupProof("attempt-a")
    cookieEntries.push({
      name: "__Host-superserve-google-signup-attempt",
      value: "attempt-a",
    })

    await expect(requireGoogleSignupProof("user-123")).rejects.toBeInstanceOf(
      GoogleSignupRecoveryRequiredError,
    )
    expect(cookieSets).toHaveLength(1)
  })

  it("promotes a legacy proof only for the callback actor", async () => {
    cookieValue = signProofPayload({
      v: 1,
      purpose: "signup_google",
      exp: Math.floor(Date.now() / 1000) + 300,
    })
    cookieEntries = [
      { name: "__Host-superserve-google-signup", value: cookieValue },
    ]
    await expect(requireGoogleSignupProof("user-123")).rejects.toThrow(
      "Google signup verification required",
    )
    await markGoogleSignupAttempt(undefined, "user-123")
    expect(await requireGoogleSignupProof("user-123")).toBeUndefined()
    await expect(requireGoogleSignupProof("another-user")).rejects.toThrow(
      "Google signup verification required",
    )
  })

  it("expires the legacy cookie with its required attributes when migrating it", async () => {
    cookieValue = signProofPayload({
      v: 1,
      purpose: "signup_google",
      exp: Math.floor(Date.now() / 1000) + 300,
      signup_attempt_id: "attempt-a",
    })
    cookieEntries = [
      { name: "__Host-superserve-google-signup", value: cookieValue },
    ]
    await markGoogleSignupAttempt("attempt-a", "user-123")

    expectSecureExpirations(["__Host-superserve-google-signup"])
    expect(await hasValidGoogleSignupProof("attempt-a")).toBe(true)
  })

  it("does not rebind a completed proof to another actor", async () => {
    await issueGoogleSignupProof("attempt-a")
    await markGoogleSignupAttempt("attempt-a", "user-123")
    await expect(
      markGoogleSignupAttempt("attempt-a", "another-user"),
    ).rejects.toThrow("Google signup verification required")
    expect(await requireGoogleSignupProof("user-123")).toBe("attempt-a")
  })

  it("revokes the failed actor's proofs without removing another actor's proof", async () => {
    await issueGoogleSignupProof("attempt-a")
    await markGoogleSignupAttempt("attempt-a", "user-123")
    await issueGoogleSignupProof("attempt-b")
    await markGoogleSignupAttempt("attempt-b", "another-user")
    await issueGoogleSignupProof("attempt-c")

    await revokeGoogleSignupAuthorization("user-123", "attempt-c")

    expectSecureExpirations([
      "__Host-superserve-google-signup-attempt-c",
      "__Host-superserve-google-signup-attempt-a",
    ])

    await expect(requireGoogleSignupProof("user-123")).rejects.toThrow(
      "Google signup verification required",
    )
    expect(await requireGoogleSignupProof("another-user")).toBe("attempt-b")
    expect(await hasValidGoogleSignupProof("attempt-c")).toBe(false)

    await revokeGoogleSignupAuthorization("user-123", "attempt-b")
    expect(await requireGoogleSignupProof("another-user")).toBe("attempt-b")
  })

  it("expires the pending marker when revoking its actor-bound proof", async () => {
    await issueGoogleSignupProof("attempt-a")
    await markGoogleSignupAttempt("attempt-a", "user-123")

    await revokeGoogleSignupAuthorization("user-123", "attempt-a")

    expectSecureExpirations([
      "__Host-superserve-google-signup-attempt-a",
      "__Host-superserve-google-signup-attempt",
    ])
    expect(cookieEntries).toEqual([])
  })

  it("expires a stale pending marker before looking for another valid proof", async () => {
    await issueGoogleSignupProof("attempt-a")
    await markGoogleSignupAttempt("attempt-a", "user-123")
    cookieEntries = cookieEntries.filter(
      ({ name }) => name !== "__Host-superserve-google-signup-attempt-a",
    )

    await expect(requireGoogleSignupProof("user-123")).rejects.toThrow(
      "Google signup verification required",
    )

    expectSecureExpirations(["__Host-superserve-google-signup-attempt"])
  })

  it("tracks proof consumption when the cookie is cleared", async () => {
    await issueGoogleSignupProof()
    mockTrackEvent.mockReset().mockResolvedValue(undefined)

    await consumeGoogleSignupProof("user-123")

    expect(cookieValue).toBeUndefined()
    expectSecureExpirations(["__Host-superserve-google-signup"])
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_proof_consumed",
      "user-123",
      { scope: "first_team_provisioning" },
    )
  })

  it("keeps a validated proof available until provisioning consumes it", async () => {
    await issueGoogleSignupProof()

    expect(await hasValidGoogleSignupProof()).toBe(true)
    expect(cookieValue).toBeDefined()

    await consumeGoogleSignupProof("user-123")

    expect(cookieValue).toBeUndefined()
  })

  it("consumes only the completed attempt proof", async () => {
    await issueGoogleSignupProof("attempt-a")
    await issueGoogleSignupProof("attempt-b")

    await consumeGoogleSignupProof("user-123", "attempt-a")

    expectSecureExpirations([
      "__Host-superserve-google-signup-attempt-a",
      "__Host-superserve-google-signup-attempt",
    ])
    expect(cookieEntries.map(({ name }) => name)).toEqual([
      "__Host-superserve-google-signup-attempt-b",
    ])
    expect(await hasValidGoogleSignupProof("attempt-b")).toBe(true)
  })

  it("preserves concurrent attempt proofs for legacy consumers without an ID", async () => {
    await issueGoogleSignupProof("attempt-a")
    await issueGoogleSignupProof("attempt-b")

    await consumeGoogleSignupProof("user-123")

    expectSecureExpirations(["__Host-superserve-google-signup-attempt-a"])
    expect(cookieEntries).toHaveLength(1)
    expect(cookieEntries[0].name).toBe(
      "__Host-superserve-google-signup-attempt-b",
    )
  })

  it("treats an expired proof as invalid", async () => {
    await issueGoogleSignupProof()
    expect(await hasValidGoogleSignupProof()).toBe(true)

    const issuedAt = Date.now()
    vi.useFakeTimers()
    vi.setSystemTime(issuedAt + 301_000)
    try {
      expect(await hasValidGoogleSignupProof()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects a tampered proof cookie", async () => {
    await issueGoogleSignupProof()
    expect(cookieValue).toBeDefined()

    const [payload, signature] = cookieValue!.split(".")
    const replacement = signature[0] === "A" ? "B" : "A"
    cookieValue = `${payload}.${replacement}${signature.slice(1)}`
    cookieEntries = [
      { name: "__Host-superserve-google-signup", value: cookieValue },
    ]

    expect(await hasValidGoogleSignupProof()).toBe(false)
  })

  it("rejects a validly signed proof with the wrong purpose", async () => {
    cookieValue = signProofPayload({
      v: 1,
      purpose: "signup_email",
      exp: Math.floor(Date.now() / 1000) + 300,
    })

    expect(await hasValidGoogleSignupProof()).toBe(false)
  })

  it("fails closed when the signing secret is missing", async () => {
    delete process.env.GOOGLE_SIGNUP_PROOF_SECRET

    await expect(issueGoogleSignupProof()).rejects.toThrow(
      "Google signup proof signing secret is not configured",
    )
    expect(await hasValidGoogleSignupProof()).toBe(false)
  })

  it("fails closed when the signing secret is too short", async () => {
    process.env.GOOGLE_SIGNUP_PROOF_SECRET = "short"

    await expect(issueGoogleSignupProof()).rejects.toThrow(
      "Google signup proof signing secret is not configured",
    )
    expect(await hasValidGoogleSignupProof()).toBe(false)
  })

  it("tracks a bypass block with a distinct telemetry id", async () => {
    await expect(requireGoogleSignupProof("user-123")).rejects.toThrow(
      "Google signup verification required",
    )
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "auth_google_signup_bypass_blocked",
      expect.any(String),
      { reason: "missing_or_invalid_proof", scope: "first_team_provisioning" },
    )
  })
})
