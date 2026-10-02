import crypto from "node:crypto"
import { writeFileSync } from "node:fs"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  bindPromotionSignupAccount,
  createPromotionSignupAttempt,
  createTeamWithPromotionAttempt,
  preparePromotionTeam,
  recoverPromotionTeam,
  completePromotionTeam,
  discoverPromotionTeams,
  getPromotionSignupEligibility,
  getPromotionSignupAccountEvidence,
  PromotionEvidenceError,
  registerPromotionSignupDevice,
  registerPromotionSignupAccount,
  verifyPromotionSignupAttempt,
} from "./promotion-device-evidence"

const { getUser, incomingHeaders } = vi.hoisted(() => ({
  getUser: vi.fn(),
  incomingHeaders: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({ auth: { getUser } })),
}))
vi.mock("next/headers", () => ({ headers: incomingHeaders }))

const userId = "38ba46cc-32ab-478c-a32e-710c4839427a"
const attemptId = "148e4dfe-e2ad-493c-b9fb-54285a2e9771"
const challenge = "db9daf04-d5d9-495d-8e9e-ab0d7842d108"
const originalPrivateKey = process.env.PROMOTION_ACCOUNT_PRIVATE_KEY
let publicKey: crypto.KeyObject

const originalCapture = process.env.PROMOTION_CAPTURE_TOKEN
const originalAccount = process.env.PROMOTION_ACCOUNT_TOKEN
const originalWestAccount = process.env.PROMOTION_ACCOUNT_TOKEN_USWEST
const originalWest = process.env.SANDBOX_API_URL_USWEST
const originalWestSupabase = process.env.SUPABASE_USWEST_URL
const originalWestKey = process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function verifyAssertion(assertion: string) {
  const [header, payload, signature] = assertion.split(".")
  expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
    alg: "EdDSA",
    typ: "JWT",
  })
  expect(
    crypto.verify(
      null,
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
  ).toBe(true)
  return JSON.parse(Buffer.from(payload, "base64url").toString())
}

describe("promotion evidence producer contract", () => {
  beforeEach(() => {
    const keys = crypto.generateKeyPairSync("ed25519")
    publicKey = keys.publicKey
    process.env.PROMOTION_ACCOUNT_PRIVATE_KEY = keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
    getUser
      .mockReset()
      .mockResolvedValue({ data: { user: { id: userId } }, error: null })
    incomingHeaders.mockReset().mockResolvedValue(
      new Headers({
        Authorization: "Bearer browser-token",
        "X-Actor-User-Id": "594a754f-6ba6-4392-afb0-3b6d35ef6a61",
        "X-Promotion-Account-Assertion": "browser-assertion",
      }),
    )
    process.env.PROMOTION_CAPTURE_TOKEN = "capture-test-token"
    process.env.PROMOTION_ACCOUNT_TOKEN = "account-test-token"
    process.env.PROMOTION_ACCOUNT_TOKEN_USWEST = "west-account-test-token"
    process.env.SANDBOX_API_URL_USWEST = "https://api-usw.test.superserve.ai"
    process.env.SUPABASE_USWEST_URL = "https://supabase-usw.test"
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "west-test-key"
  })

  afterEach(() => {
    if (originalPrivateKey === undefined)
      delete process.env.PROMOTION_ACCOUNT_PRIVATE_KEY
    else process.env.PROMOTION_ACCOUNT_PRIVATE_KEY = originalPrivateKey
    vi.unstubAllGlobals()
    if (originalCapture === undefined)
      delete process.env.PROMOTION_CAPTURE_TOKEN
    else process.env.PROMOTION_CAPTURE_TOKEN = originalCapture
    if (originalAccount === undefined)
      delete process.env.PROMOTION_ACCOUNT_TOKEN
    else process.env.PROMOTION_ACCOUNT_TOKEN = originalAccount
    if (originalWestAccount === undefined)
      delete process.env.PROMOTION_ACCOUNT_TOKEN_USWEST
    else process.env.PROMOTION_ACCOUNT_TOKEN_USWEST = originalWestAccount
    if (originalWest === undefined) delete process.env.SANDBOX_API_URL_USWEST
    else process.env.SANDBOX_API_URL_USWEST = originalWest
    if (originalWestSupabase === undefined)
      delete process.env.SUPABASE_USWEST_URL
    else process.env.SUPABASE_USWEST_URL = originalWestSupabase
    if (originalWestKey === undefined)
      delete process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY
    else process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = originalWestKey
  })

  it("uses capture credential and the exact provider attestation fields", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ attempt_id: attemptId, challenge }))
      .mockResolvedValueOnce(response({ outcome: "verified" }))
    vi.stubGlobal("fetch", fetcher)

    expect(await createPromotionSignupAttempt()).toEqual({
      attemptId,
      challenge,
    })
    expect(
      await verifyPromotionSignupAttempt({
        attemptId,
        challenge,
        eventId: "provider-event",
        fingerprint: "exact-CaSe",
        eventAt: "2026-09-25T10:00:00Z",
      }),
    ).toBe("verified")

    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.test.superserve.ai/internal/promotion/signup/attempts",
    )
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer capture-test-token",
    )
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      attempt_id: attemptId,
      challenge,
      event_id: "provider-event",
      fingerprint: "exact-CaSe",
      event_at: "2026-09-25T10:00:00Z",
    })
  })

  it("signs the original pre-confirmation signup tuple for East without a login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const fetcher = vi.fn().mockResolvedValue(response({ outcome: "owner" }))
    vi.stubGlobal("fetch", fetcher)
    await expect(
      registerPromotionSignupAccount(userId, attemptId),
    ).resolves.toBe("owner")
    expect(getUser).not.toHaveBeenCalled()
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe(
      "https://api.test.superserve.ai/internal/promotion/account/register-signup",
    )
    expect(options.headers.Authorization).toBe("Bearer account-test-token")
    expect(options.headers["X-Actor-User-Id"]).toBe(userId)
    expect(JSON.parse(options.body)).toEqual({
      user_id: userId,
      attempt_id: attemptId,
      home_region: "use",
    })
    expect(
      verifyAssertion(options.headers["X-Promotion-Account-Assertion"]),
    ).toMatchObject({
      sub: userId,
      operation: "register-signup",
      attempt_id: attemptId,
      home_region: "use",
    })
  })

  it("retries an uncertain signup registration with the exact original tuple", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(response({ outcome: "owner_conflict" }))
    vi.stubGlobal("fetch", fetcher)
    await expect(
      registerPromotionSignupAccount(userId, attemptId),
    ).rejects.toMatchObject({ code: "authority_unavailable" })
    await expect(
      registerPromotionSignupAccount(userId, attemptId),
    ).resolves.toBe("owner_conflict")
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
  })

  it("binds the trusted actor and retrieves original account evidence", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ outcome: "bound" }))
      .mockResolvedValueOnce(
        response({
          attempt_id: attemptId,
          event_id: "provider-event",
          fingerprint: "exact-CaSe",
          event_at: "2026-09-25T10:00:00Z",
          bound_at: "2026-09-25T10:01:00Z",
        }),
      )
    vi.stubGlobal("fetch", fetcher)

    expect(await bindPromotionSignupAccount(userId, attemptId)).toBe("bound")
    expect(await getPromotionSignupAccountEvidence(userId)).toMatchObject({
      attemptId,
      fingerprint: "exact-CaSe",
    })
    for (const [, options] of fetcher.mock.calls) {
      expect(options.headers.Authorization).toBe("Bearer account-test-token")
      expect(options.headers["X-Actor-User-Id"]).toBe(userId)
      expect(JSON.parse(options.body).user_id).toBe(userId)
    }
  })

  it("registers the same account independently in West without sending a device", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ outcome: "owner_conflict" }))
    vi.stubGlobal("fetch", fetcher)

    expect(await registerPromotionSignupDevice("usw", userId)).toBe(
      "owner_conflict",
    )
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api-usw.test.superserve.ai/internal/promotion/account/register",
    )
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer west-account-test-token",
    )
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      user_id: userId,
    })
  })

  it("distinguishes truly missing evidence from authority failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ error: { code: "evidence_missing" } }, 404),
        )
        .mockResolvedValueOnce(
          response({ error: { code: "authority_unavailable" } }, 503),
        ),
    )
    await expect(
      getPromotionSignupAccountEvidence(userId),
    ).rejects.toMatchObject({ code: "evidence_missing" })
    await expect(
      getPromotionSignupAccountEvidence(userId),
    ).rejects.toMatchObject({ code: "authority_unavailable" })
  })

  it("rejects missing or shared producer credentials before any request", async () => {
    process.env.PROMOTION_ACCOUNT_TOKEN = "capture-test-token"
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    await expect(createPromotionSignupAttempt()).rejects.toBeInstanceOf(
      PromotionEvidenceError,
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("withholds West registration when its scoped account credential is absent or reused", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    delete process.env.PROMOTION_ACCOUNT_TOKEN_USWEST
    await expect(
      registerPromotionSignupDevice("usw", userId),
    ).rejects.toMatchObject({ code: "authority_unavailable" })
    process.env.PROMOTION_ACCOUNT_TOKEN_USWEST = "account-test-token"
    await expect(
      registerPromotionSignupDevice("usw", userId),
    ).rejects.toMatchObject({ code: "authority_unavailable" })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("rejects reuse of the West internal credential before transport", async () => {
    const previous = process.env.INTERNAL_API_TOKEN_USWEST
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    try {
      process.env.INTERNAL_API_TOKEN_USWEST = "west-account-test-token"
      await expect(
        registerPromotionSignupDevice("usw", userId),
      ).rejects.toMatchObject({ code: "authority_unavailable" })
      process.env.INTERNAL_API_TOKEN_USWEST = "capture-test-token"
      await expect(createPromotionSignupAttempt()).rejects.toMatchObject({
        code: "authority_unavailable",
      })
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.INTERNAL_API_TOKEN_USWEST
      else process.env.INTERNAL_API_TOKEN_USWEST = previous
    }
  })

  it.each([
    ["missing credential", { data: { user: null }, error: null }],
    [
      "invalid credential",
      { data: { user: null }, error: new Error("invalid login") },
    ],
    [
      "expired credential",
      { data: { user: null }, error: new Error("expired login") },
    ],
    [
      "verification error with a user",
      {
        data: { user: { id: userId } },
        error: new Error("verification failed"),
      },
    ],
  ])("rejects %s before signing or backend access", async (_name, result) => {
    getUser.mockResolvedValue(result)
    const fetcher = vi.fn()
    const signer = vi.spyOn(crypto, "sign")
    vi.stubGlobal("fetch", fetcher)
    await expect(
      getPromotionSignupAccountEvidence(userId),
    ).rejects.toMatchObject({ code: "forbidden" })
    await expect(
      registerPromotionSignupDevice("usw", userId),
    ).rejects.toMatchObject({ code: "forbidden" })
    expect(getUser).toHaveBeenCalledTimes(2)
    expect(signer).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("waits for Auth verification before signing a regional request", async () => {
    let finishVerification!: (value: unknown) => void
    getUser.mockReturnValue(
      new Promise((resolve) => {
        finishVerification = resolve
      }),
    )
    const fetcher = vi.fn().mockResolvedValue(response({ outcome: "owner" }))
    const signer = vi.spyOn(crypto, "sign")
    vi.stubGlobal("fetch", fetcher)
    const registration = registerPromotionSignupDevice("usw")
    await Promise.resolve()
    expect(getUser).toHaveBeenCalledOnce()
    expect(signer).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    finishVerification({ data: { user: { id: userId } }, error: null })
    await expect(registration).resolves.toBe("owner")
    expect(signer).toHaveBeenCalledOnce()
  })

  it("rejects Auth transport errors before signing", async () => {
    getUser.mockRejectedValue(new Error("Auth unavailable"))
    const fetcher = vi.fn()
    const signer = vi.spyOn(crypto, "sign")
    vi.stubGlobal("fetch", fetcher)
    await expect(getPromotionSignupAccountEvidence()).rejects.toMatchObject({
      code: "forbidden",
    })
    await expect(registerPromotionSignupDevice("use")).rejects.toMatchObject({
      code: "forbidden",
    })
    expect(signer).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("rejects another target even when browser actor and body IDs match", async () => {
    const otherUser = "594a754f-6ba6-4392-afb0-3b6d35ef6a61"
    const fetcher = vi.fn()
    const signer = vi.spyOn(crypto, "sign")
    vi.stubGlobal("fetch", fetcher)
    await expect(
      getPromotionSignupAccountEvidence(otherUser),
    ).rejects.toMatchObject({ code: "forbidden" })
    await expect(
      registerPromotionSignupDevice("usw", otherUser),
    ).rejects.toMatchObject({ code: "forbidden" })
    expect(signer).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("binds trusted signup provenance before confirmation without a login", async () => {
    getUser.mockRejectedValue(new Error("No session before confirmation"))
    const fetcher = vi.fn().mockResolvedValue(response({ outcome: "bound" }))
    vi.stubGlobal("fetch", fetcher)
    expect(await bindPromotionSignupAccount(userId, attemptId)).toBe("bound")
    expect(getUser).not.toHaveBeenCalled()
    const claims = verifyAssertion(
      fetcher.mock.calls[0][1].headers["X-Promotion-Account-Assertion"],
    )
    expect(claims).toMatchObject({
      sub: userId,
      operation: "bind",
      attempt_id: attemptId,
    })
  })

  it.each([undefined, "invalid private key"])(
    "withholds account calls without a valid signing key (%s)",
    async (key) => {
      if (key === undefined) delete process.env.PROMOTION_ACCOUNT_PRIVATE_KEY
      else process.env.PROMOTION_ACCOUNT_PRIVATE_KEY = key
      const fetcher = vi.fn()
      vi.stubGlobal("fetch", fetcher)
      await expect(getPromotionSignupAccountEvidence()).rejects.toMatchObject({
        code: "authority_unavailable",
      })
      await expect(registerPromotionSignupDevice("usw")).rejects.toMatchObject({
        code: "authority_unavailable",
      })
      await expect(
        bindPromotionSignupAccount(userId, attemptId),
      ).rejects.toMatchObject({ code: "authority_unavailable" })
      expect(fetcher).not.toHaveBeenCalled()
    },
  )

  it("signs interoperable assertions from verified identity and reuses original evidence in West", async () => {
    const userId = crypto.randomUUID()
    const attemptId = crypto.randomUUID()
    const creation = {
      userId,
      attemptId: crypto.randomUUID(),
      teamId: crypto.randomUUID(),
      name: "interop-team",
      region: "usw",
      authorityUnavailable: true,
    }
    getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ outcome: "bound" }))
      .mockResolvedValueOnce(
        response({
          attempt_id: attemptId,
          event_id: "original-provider-event",
          fingerprint: "original-CaSe",
          event_at: "2026-01-01T10:00:00Z",
          bound_at: "2026-01-01T10:01:00Z",
        }),
      )
      .mockResolvedValueOnce(response({ outcome: "owner" }))
      .mockResolvedValueOnce(
        response({
          team_id: creation.teamId,
          outcome: "promotion_ineligible",
          reason: "authority_unavailable",
        }),
      )
    vi.stubGlobal("fetch", fetcher)
    await bindPromotionSignupAccount(userId, attemptId)
    expect(await getPromotionSignupAccountEvidence()).toMatchObject({
      fingerprint: "original-CaSe",
    })
    expect(await registerPromotionSignupDevice("usw")).toBe("owner")
    expect(await createTeamWithPromotionAttempt(creation)).toMatchObject({
      teamId: creation.teamId,
      outcome: "promotion_ineligible",
    })
    expect(getUser).toHaveBeenCalledTimes(3)
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(incomingHeaders).not.toHaveBeenCalled()
    const requests = fetcher.mock.calls.map(([url, options]) => {
      const assertion = options.headers["X-Promotion-Account-Assertion"]
      const claims = verifyAssertion(assertion)
      const operation = new URL(url).pathname.split("/").at(-1)
      const creationBinding =
        operation === "create-team"
          ? {
              attempt_id: creation.attemptId,
              team_id: creation.teamId,
              home_region: creation.region,
              authority_unavailable: creation.authorityUnavailable,
            }
          : {}
      expect(claims).toEqual({
        iss: "promotion-auth-adapter",
        aud: "promotion-account",
        sub: userId,
        iat: expect.any(Number),
        exp: expect.any(Number),
        operation,
        ...(operation === "bind" ? { attempt_id: attemptId } : {}),
        ...creationBinding,
      })
      expect(claims.exp - claims.iat).toBe(300)
      expect(options.headers["X-Actor-User-Id"]).toBe(userId)
      expect(options.headers.Authorization).toBe(
        operation === "register" || operation === "create-team"
          ? "Bearer west-account-test-token"
          : "Bearer account-test-token",
      )
      expect(JSON.parse(options.body)).toEqual({
        user_id: userId,
        ...(operation === "bind" ? { attempt_id: attemptId } : {}),
        ...creationBinding,
        ...(operation === "create-team" ? { name: creation.name } : {}),
      })
      return {
        operation,
        assertion,
        body: JSON.parse(options.body),
        actor: userId,
      }
    })
    expect(requests.map(({ operation }) => operation)).toEqual([
      "bind",
      "evidence",
      "register",
      "create-team",
    ])
    // The runner can pass this fresh producer output directly to the Go verifier.
    const fixturePath = process.env.PROMOTION_ASSERTION_FIXTURE_OUT
    if (fixturePath) {
      const jwk = publicKey.export({ format: "jwk" })
      writeFileSync(
        fixturePath,
        JSON.stringify({
          public_key: Buffer.from(jwk.x!, "base64url").toString("base64"),
          requests,
        }),
      )
    }
  })

  const creation = {
    userId,
    attemptId: "90dbe348-26ac-46a1-b613-1c913d8d91bd",
    teamId: "d550eb29-f9f6-4537-bc9a-8a5f4f921e52",
    name: "example-team",
    region: "usw",
    authorityUnavailable: true,
  }

  const operationId = "185efc3c-af39-4349-b215-7d0fbf372abb"
  const prepared = {
    user_id: userId,
    operation_id: operationId,
    attempt_id: creation.attemptId,
    team_id: creation.teamId,
    name: creation.name,
    home_region: "usw",
    authority_unavailable: true,
    created_at: "2026-10-01T00:00:00Z",
    state: "prepared",
    outcome: null,
    reason: null,
  }
  const locator = { userId, operationId, region: "usw" }

  it("recovers a lost prepare response and signs the backend's unchanged no-credit tuple", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost prepare response"))
      .mockResolvedValueOnce(response(prepared))
      .mockRejectedValueOnce(new Error("lost completion response"))
      .mockResolvedValueOnce(
        response({
          ...prepared,
          state: "completed",
          outcome: "promotion_ineligible",
          reason: "authority_unavailable",
        }),
      )
    vi.stubGlobal("fetch", fetcher)
    await expect(
      preparePromotionTeam({
        ...locator,
        name: creation.name,
        authorityUnavailable: true,
      }),
    ).rejects.toMatchObject({ code: "authority_unavailable" })
    const recovered = await recoverPromotionTeam(locator)
    expect(recovered).toMatchObject({
      ...locator,
      authorityUnavailable: true,
      state: "prepared",
    })
    await expect(completePromotionTeam(recovered!)).rejects.toMatchObject({
      code: "authority_unavailable",
    })
    expect(await recoverPromotionTeam(locator)).toMatchObject({
      state: "completed",
      outcome: "promotion_ineligible",
    })
    expect(
      fetcher.mock.calls.map(([url]) =>
        new URL(url).pathname.split("/").at(-1),
      ),
    ).toEqual(["prepare-team", "recover-team", "complete-team", "recover-team"])
    for (const [url, options] of fetcher.mock.calls) {
      const { user_id, ...fields } = JSON.parse(options.body)
      expect(user_id).toBe(userId)
      expect(options.headers.Authorization).toBe(
        "Bearer west-account-test-token",
      )
      expect(
        verifyAssertion(options.headers["X-Promotion-Account-Assertion"]),
      ).toEqual({
        iss: "promotion-auth-adapter",
        aud: "promotion-account",
        sub: userId,
        iat: expect.any(Number),
        exp: expect.any(Number),
        operation: new URL(url).pathname.split("/").at(-1),
        ...fields,
      })
    }
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      user_id: userId,
      operation_id: operationId,
      attempt_id: creation.attemptId,
      team_id: creation.teamId,
      name: creation.name,
      home_region: "usw",
      authority_unavailable: true,
    })
  })

  it.each([
    [404, "creation_missing", null],
    [404, "not_found", "authority_unavailable"],
    [503, "authority_unavailable", "authority_unavailable"],
    [409, "creation_conflict", "creation_conflict"],
  ])(
    "distinguishes recover status %s / %s from a missing operation",
    async (status, code, expected) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(response({ error: { code } }, status))
      vi.stubGlobal("fetch", fetcher)
      if (expected === null)
        expect(await recoverPromotionTeam(locator)).toBeNull()
      else
        await expect(recoverPromotionTeam(locator)).rejects.toMatchObject({
          code: expected,
        })
      expect(fetcher).toHaveBeenCalledTimes(1)
    },
  )

  it("completes and replays one prepared binding, including after deletion", async () => {
    const completed = {
      ...prepared,
      state: "completed",
      outcome: "promotion_ineligible",
      reason: "authority_unavailable",
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(prepared))
      .mockResolvedValueOnce(response(completed))
      .mockResolvedValueOnce(response(completed))
      .mockResolvedValueOnce(response({ ...completed, state: "deleted" }))
    vi.stubGlobal("fetch", fetcher)
    const binding = await preparePromotionTeam({
      ...locator,
      name: creation.name,
      authorityUnavailable: true,
    })
    expect(await completePromotionTeam(binding)).toMatchObject({
      state: "completed",
      authorityUnavailable: true,
    })
    expect(await completePromotionTeam(binding)).toMatchObject({
      state: "completed",
      authorityUnavailable: true,
    })
    expect(await completePromotionTeam(binding)).toMatchObject({
      state: "deleted",
      authorityUnavailable: true,
    })
    expect(
      new Set(fetcher.mock.calls.slice(1).map(([, options]) => options.body))
        .size,
    ).toBe(1)
  })

  it.each([
    { user_id: crypto.randomUUID() },
    { operation_id: crypto.randomUUID() },
    { home_region: "use" },
    { attempt_id: "" },
    { authority_unavailable: null },
    { state: "prepared", outcome: "granted" },
    { state: "completed", outcome: null },
    { state: ["completed"], outcome: "granted", reason: "eligible" },
    { state: "completed", outcome: ["granted"], reason: "eligible" },
  ])(
    "rejects mismatched or malformed recovered authority: %j",
    async (change) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({ ...prepared, ...change })),
      )
      await expect(recoverPromotionTeam(locator)).rejects.toMatchObject({
        code: "authority_unavailable",
      })
    },
  )

  it("retains deleted outcomes without recreation and requires explicit discovery selection", async () => {
    const deleted = {
      ...prepared,
      state: "deleted",
      outcome: "granted",
      reason: "eligible",
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(deleted))
      .mockResolvedValueOnce(
        response({
          state: "selection_required",
          operations: [deleted],
          next_cursor: null,
        }),
      )
    vi.stubGlobal("fetch", fetcher)
    expect(await recoverPromotionTeam(locator)).toMatchObject({
      state: "deleted",
      outcome: "granted",
    })
    const result = await discoverPromotionTeams({
      userId,
      region: "usw",
      after: operationId,
    })
    expect(result).toMatchObject({
      state: "selection_required",
      operations: [{ state: "deleted" }],
      nextCursor: null,
    })
    const options = fetcher.mock.calls[1][1]
    expect(JSON.parse(options.body)).toEqual({
      user_id: userId,
      home_region: "usw",
      after: operationId,
    })
    expect(
      verifyAssertion(options.headers["X-Promotion-Account-Assertion"]),
    ).toMatchObject({
      operation: "discover-team-creations",
      home_region: "usw",
      after: operationId,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("rejects a substituted account before accessing any recovery route", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    getUser.mockResolvedValue({
      data: { user: { id: crypto.randomUUID() } },
      error: null,
    })
    await expect(recoverPromotionTeam(locator)).rejects.toMatchObject({
      code: "forbidden",
    })
    await expect(
      preparePromotionTeam({
        ...locator,
        name: creation.name,
        authorityUnavailable: true,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    await expect(discoverPromotionTeams(locator)).rejects.toMatchObject({
      code: "forbidden",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("signs the complete creation binding and replays it after a lost response", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost after commit"))
      .mockResolvedValue(
        response({
          team_id: creation.teamId,
          outcome: "promotion_ineligible",
          reason: "authority_unavailable",
        }),
      )
    vi.stubGlobal("fetch", fetcher)
    await expect(
      createTeamWithPromotionAttempt(creation),
    ).rejects.toMatchObject({
      code: "authority_unavailable",
    })
    expect(await createTeamWithPromotionAttempt(creation)).toEqual({
      teamId: creation.teamId,
      outcome: "promotion_ineligible",
      reason: "authority_unavailable",
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe(
        "https://api-usw.test.superserve.ai/internal/promotion/account/create-team",
      )
      expect(options.headers.Authorization).toBe(
        "Bearer west-account-test-token",
      )
      expect(options.headers["X-Actor-User-Id"]).toBe(userId)
      expect(JSON.parse(options.body)).toEqual({
        user_id: userId,
        attempt_id: creation.attemptId,
        team_id: creation.teamId,
        name: creation.name,
        home_region: "usw",
        authority_unavailable: true,
      })
      expect(
        verifyAssertion(options.headers["X-Promotion-Account-Assertion"]),
      ).toMatchObject({
        sub: userId,
        operation: "create-team",
        attempt_id: creation.attemptId,
        team_id: creation.teamId,
        home_region: "usw",
        authority_unavailable: true,
      })
    }
  })

  it("preserves an original grant outcome without inferring a new grant on replay", async () => {
    const fetcher = vi.fn().mockImplementation(async () =>
      response({
        team_id: creation.teamId,
        outcome: "granted",
        reason: "eligible",
      }),
    )
    vi.stubGlobal("fetch", fetcher)
    const binding = { ...creation, region: "use", authorityUnavailable: false }
    for (let i = 0; i < 2; i++) {
      expect(await createTeamWithPromotionAttempt(binding)).toMatchObject({
        outcome: "granted",
      })
    }
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
    expect(
      verifyAssertion(
        fetcher.mock.calls[0][1].headers["X-Promotion-Account-Assertion"],
      ),
    ).toMatchObject({ home_region: "use", authority_unavailable: false })
  })

  it("rejects a creation actor substitution before signing", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    const signer = vi.spyOn(crypto, "sign")
    await expect(
      createTeamWithPromotionAttempt({ ...creation, userId: "other-account" }),
    ).rejects.toMatchObject({ code: "forbidden" })
    expect(signer).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    { team_id: "another-team", outcome: "granted", reason: "eligible" },
    { team_id: creation.teamId, outcome: "created", reason: "eligible" },
    { team_id: creation.teamId, outcome: "granted" },
  ])(
    "rejects an ambiguous creation response %j without a fallback",
    async (payload) => {
      const fetcher = vi.fn().mockResolvedValue(response(payload))
      vi.stubGlobal("fetch", fetcher)
      await expect(
        createTeamWithPromotionAttempt(creation),
      ).rejects.toMatchObject({
        code: "authority_unavailable",
      })
      expect(fetcher).toHaveBeenCalledOnce()
    },
  )

  it("consumes a non-issuing East snapshot without upgrading unknown eligibility", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        ownership: "owner",
        device_decision: "eligible",
        eligibility: "unknown",
        reason: "team_checks_pending",
      }),
    )
    vi.stubGlobal("fetch", fetcher)
    expect(await getPromotionSignupEligibility()).toEqual({
      ownership: "owner",
      deviceDecision: "eligible",
      eligibility: "unknown",
      reason: "team_checks_pending",
    })
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.test.superserve.ai/internal/promotion/account/signup-eligibility",
    )
    const claims = verifyAssertion(
      fetcher.mock.calls[0][1].headers["X-Promotion-Account-Assertion"],
    )
    expect(claims).toMatchObject({
      sub: userId,
      operation: "signup-eligibility",
    })
    expect(claims).not.toHaveProperty("attempt_id")
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      user_id: userId,
    })
  })
})
