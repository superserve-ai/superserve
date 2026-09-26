import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  bindPromotionSignupAccount,
  createPromotionSignupAttempt,
  getPromotionSignupAccountEvidence,
  PromotionEvidenceError,
  registerPromotionSignupDevice,
  verifyPromotionSignupAttempt,
} from "./promotion-device-evidence"

const userId = "38ba46cc-32ab-478c-a32e-710c4839427a"
const attemptId = "148e4dfe-e2ad-493c-b9fb-54285a2e9771"
const challenge = "db9daf04-d5d9-495d-8e9e-ab0d7842d108"
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

describe("SS-641 promotion evidence producer contract", () => {
  beforeEach(() => {
    process.env.PROMOTION_CAPTURE_TOKEN = "capture-test-token"
    process.env.PROMOTION_ACCOUNT_TOKEN = "account-test-token"
    process.env.PROMOTION_ACCOUNT_TOKEN_USWEST = "west-account-test-token"
    process.env.SANDBOX_API_URL_USWEST = "https://api-usw.test.superserve.ai"
    process.env.SUPABASE_USWEST_URL = "https://supabase-usw.test"
    process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY = "west-test-key"
  })

  afterEach(() => {
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
})
