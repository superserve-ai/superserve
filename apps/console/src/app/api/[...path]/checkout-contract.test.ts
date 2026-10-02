import crypto from "node:crypto"

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  readCheckoutIntent,
  signCheckoutIntent,
} from "@/lib/api/checkout-intent"

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetch: vi.fn(),
  repair: vi.fn(),
  context: vi.fn(),
  evidence: vi.fn(),
  register: vi.fn(),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (region: string) => ({
    apiBaseUrl: `https://api-${region}.test`,
    createAdminClient: () => ({ rpc: mocks.rpc }),
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: actor } }) },
  }),
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForRecovery: mocks.context,
  getAuthApiKeyAndTeamForUser: vi.fn(),
  getAuthApiKeyForUser: vi.fn(),
  repairRecoveryAuthApiKeyForTeam: mocks.repair,
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: async () => null,
}))
vi.mock("@/lib/api/promotion-device-evidence", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/api/promotion-device-evidence")
  >()),
  getPromotionSignupAccountEvidence: mocks.evidence,
  registerPromotionSignupDevice: mocks.register,
}))
import { POST } from "./route"
const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "Raw+Tag@Example.COM",
  email_confirmed_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  created_at: "2024-01-01T00:00:00Z",
}
const operation = "22222222-2222-4222-8222-222222222222"
const pair = crypto.generateKeyPairSync("ed25519")
const prepareBody = {
  prepare: true,
  operation_id: operation,
  success_url: "https://console.test/success",
  cancel_url: "https://console.test/cancel",
}
const missing = () =>
  Response.json(
    { error: { code: "checkout_recovery_unavailable" } },
    { status: 409 },
  )
async function checkout(
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return POST(
    new NextRequest("https://console.test/api/stripe/checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: ["stripe", "checkout-session"] }) },
  )
}
function useRegion(region: string) {
  mocks.context.mockResolvedValue({
    apiKey: "payer-key",
    team: { teamId: `team-${region}`, region },
  })
}
function receipt(
  region = "use",
  decision: "standard" | "publication_failed" = "standard",
) {
  return signCheckoutIntent({
    actor: actor.id,
    team: `team-${region}`,
    operation_id: operation,
    home_region: region,
    decision,
    success_url: prepareBody.success_url,
    cancel_url: prepareBody.cancel_url,
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", mocks.fetch)
  vi.stubEnv(
    "GOOGLE_SIGNUP_PROOF_SECRET",
    "a-signing-secret-at-least-32-bytes-long",
  )
  vi.stubEnv(
    "PROMOTION_ACCOUNT_PRIVATE_KEY",
    pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  )
  mocks.rpc.mockResolvedValue({
    data: [{ outcome: "applied", evidence_version: "v1" }],
    error: null,
  })
  mocks.evidence.mockResolvedValue({ attemptId: "original" })
  mocks.register.mockResolvedValue("owner")
  mocks.repair.mockResolvedValue("payer-key")
  useRegion("use")
  mocks.fetch.mockImplementation(async (url: string) =>
    url.endsWith("/recover")
      ? missing()
      : Response.json({
          id: "cs_new",
          url: "https://checkout.stripe.test/new",
        }),
  )
})
describe("trusted Checkout publication contract", () => {
  it.each(["use", "usw"])(
    "prepares and signs the actual payer/region decision in %s",
    async (region) => {
      useRegion(region)
      const prepared = await checkout(
        { ...prepareBody, user_id: "forged", decision: "publication_failed" },
        { "x-api-key": "forged" },
      )
      expect(prepared.status).toBe(200)
      const { receipt: retained } = await prepared.json()
      expect(
        readCheckoutIntent(retained, actor.id, `team-${region}`, region)
          .decision,
      ).toBe("standard")
      expect(mocks.rpc).toHaveBeenCalledWith(
        "upsert_profile_with_promotion_identity",
        expect.objectContaining({
          p_user_id: actor.id,
          p_email: actor.email,
          p_email_verified: true,
        }),
      )
      expect(mocks.register).toHaveBeenCalledWith(region, actor.id)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const result = await checkout({ receipt: retained })
      expect(result.status).toBe(200)
      const [url, init] = mocks.fetch.mock.calls[2]
      expect(url).toBe(
        `https://api-${region}.test/stripe/checkout-session/publication-decision`,
      )
      const body = JSON.parse(init.body)
      expect(body).toEqual({
        operation_id: operation,
        home_region: region,
        decision: "standard",
        success_url: prepareBody.success_url,
        cancel_url: prepareBody.cancel_url,
      })
      expect(init.headers.get("x-api-key")).toBe("payer-key")
      const [header, payload, signature] = init.headers
        .get("X-Promotion-Account-Assertion")
        .split(".")
      expect(
        crypto.verify(
          null,
          Buffer.from(`${header}.${payload}`),
          pair.publicKey,
          Buffer.from(signature, "base64url"),
        ),
      ).toBe(true)
      expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
        iss: "promotion-auth-adapter",
        aud: "promotion-account",
        sub: actor.id,
        iat: expect.any(Number),
        exp: expect.any(Number),
        operation: "checkout",
        team_id: `team-${region}`,
        ...body,
      })
      expect(mocks.rpc).toHaveBeenCalledTimes(1)
    },
  )
  it.each(["canonical", "device"])(
    "pins no credit after %s publication failure and never upgrades on replay",
    async (failure) => {
      if (failure === "canonical")
        mocks.rpc.mockResolvedValue({ data: null, error: { code: "55000" } })
      else mocks.register.mockRejectedValue(new Error("unavailable"))
      const { receipt: retained } = await (await checkout(prepareBody)).json()
      expect(
        readCheckoutIntent(retained, actor.id, "team-use", "use").decision,
      ).toBe("publication_failed")
      mocks.rpc.mockResolvedValue({
        data: [{ outcome: "applied", evidence_version: "v1" }],
        error: null,
      })
      mocks.register.mockResolvedValue("owner")
      mocks.fetch
        .mockImplementationOnce(async () => missing())
        .mockRejectedValueOnce(new Error("lost response"))
      await expect(checkout({ receipt: retained })).rejects.toThrow(
        "lost response",
      )
      expect((await checkout({ receipt: retained })).status).toBe(200)
      const creations = mocks.fetch.mock.calls.filter(([url]) =>
        url.endsWith("/publication-decision"),
      )
      expect(creations).toHaveLength(2)
      expect(creations[0][1].body).toBe(creations[1][1].body)
      expect(JSON.parse(creations[1][1].body).decision).toBe(
        "publication_failed",
      )
      expect(mocks.rpc).toHaveBeenCalledTimes(1)
    },
  )
  it("recovers without any receipt or publication", async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ id: "original", url: "original-url" }),
    )
    expect(await (await checkout()).json()).toEqual({
      id: "original",
      url: "original-url",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([404, 403, 502, 503])(
    "never falls back after recovery status %s",
    async (status) => {
      mocks.fetch.mockResolvedValueOnce(new Response(null, { status }))
      expect((await checkout({ receipt: receipt() })).status).toBe(status)
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    },
  )
  it("rejects missing intent at direct legacy Console endpoint", async () => {
    expect((await checkout()).status).toBe(409)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it.each(["tampered", "wrong team"])(
    "rejects %s receipt before creation",
    async (mode) => {
      const retained = mode === "tampered" ? `${receipt()}x` : receipt("usw")
      expect((await checkout({ receipt: retained })).status).toBe(400)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    },
  )
  it.each(["failed", "changed"])("stops when key repair %s", async (mode) => {
    if (mode === "failed")
      mocks.repair.mockRejectedValue(new Error("unavailable"))
    else mocks.repair.mockResolvedValue("wrong-key")
    expect((await checkout({ receipt: receipt() })).status).toBe(503)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("keeps the selected cell and key after a directory change during recovery", async () => {
    useRegion("usw")
    const result = await checkout({ receipt: receipt("usw") })
    expect(result.status).toBe(200)
    expect(mocks.context).toHaveBeenCalledTimes(1)
    expect(mocks.repair).toHaveBeenCalledWith(actor, {
      teamId: "team-usw",
      region: "usw",
    })
    expect(
      mocks.fetch.mock.calls.every(([url]) =>
        url.startsWith("https://api-usw.test/"),
      ),
    ).toBe(true)
  })
})
