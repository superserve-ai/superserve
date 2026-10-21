import { createHash, generateKeyPairSync, verify } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { signProof } from "./signed-proof"
import { decideStaffClaim, getStaffClaim, listStaffClaims } from "./staff-api"

const f = vi.hoisted(() => ({
  user: vi.fn(),
  claims: vi.fn(),
  impersonation: vi.fn(),
  cookie: vi.fn(),
}))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: f.cookie }) }))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: f.user, getClaims: f.claims },
  }),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: f.impersonation,
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  configuredRegions: () => ["use", "usw"],
  cellFor: (region: string) => ({
    apiBaseUrl: `https://${region}.example.com`,
  }),
}))
const actor = "11111111-1111-4111-8111-111111111111"
const id = "22222222-2222-4222-8222-222222222222"
const claim = {
  id,
  state: "bound",
  revision: 1,
  submitted_email: "founder@example.com",
  company_identity: null,
  team_id: null,
  claimed_user_id: null,
  home_region: null,
  reason: "reviewed",
  acceptance_required: true,
  approval_notification: null,
}
const keys = generateKeyPairSync("ed25519")
const fetchMock = vi.fn()
const user = () => ({
  id: actor,
  email: "staff@superserve.ai",
  email_confirmed_at: "2026-01-01",
  app_metadata: { provider: "google", providers: ["google"] },
  identities: [
    {
      provider: "google",
      identity_data: {
        sub: "google-sub",
        email: "staff@superserve.ai",
        email_verified: true,
      },
    },
  ],
})
beforeEach(() => {
  vi.stubEnv("YC_STAFF_UI_ENABLED", "true")
  vi.stubEnv(
    "PROMOTION_ACCOUNT_PRIVATE_KEY",
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  )
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify(claim)))
  f.user.mockResolvedValue({ data: { user: user() }, error: null })
  f.claims.mockResolvedValue({
    data: {
      claims: {
        sub: actor,
        session_id: "original-session",
        amr: [{ method: "oauth" }],
      },
    },
    error: null,
  })
  f.cookie.mockReturnValue({
    value: signProof(
      "yc-staff-google-session",
      { actor, session: "original-session", google: "google-sub" },
      900,
    ),
  })
  f.impersonation.mockResolvedValue(null)
})
describe("staff request authority", () => {
  it("signs exact transmitted URI, actor and bytes with the dedicated audience", async () => {
    const input = {
      id,
      request_id: actor,
      expected_revision: 0,
      decision: "reject" as const,
      reason: "Not eligible",
      evidence_reference: "review record",
    }
    await decideStaffClaim(input, "usw")
    const [url, options] = fetchMock.mock.calls[0]
    expect(url.toString()).toBe(
      "https://usw.example.com/internal/yc/staff/claims/decision",
    )
    const [header, payload, signature] =
      options.headers["X-YC-Staff-Assertion"].split(".")
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        keys.publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true)
    const assertion = JSON.parse(Buffer.from(payload, "base64url").toString())
    expect(assertion).toMatchObject({
      sub: actor,
      aud: "yc-staff",
      operation: "decision",
      method: "POST",
      path: url.pathname,
      provider: "google",
      email_verified: true,
      body_sha256: createHash("sha256").update(options.body).digest("hex"),
    })
    expect(assertion.exp - assertion.iat).toBe(60)
    expect(options).toMatchObject({ cache: "no-store", redirect: "error" })
    expect(options.headers.Authorization).toBeUndefined()
    expect(options.headers["X-Actor-User-Id"]).toBeUndefined()
  })
  it("binds the full list query and empty GET body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ claims: [] })))
    await listStaffClaims("manual_review", id)
    const [, options] = fetchMock.mock.calls[0]
    const payload = JSON.parse(
      Buffer.from(
        options.headers["X-YC-Staff-Assertion"].split(".")[1],
        "base64url",
      ).toString(),
    )
    expect(payload.path).toBe(
      `/internal/yc/staff/claims?state=manual_review&after_id=${id}`,
    )
    expect(payload.body_sha256).toBe(
      createHash("sha256").update("").digest("hex"),
    )
    expect(options.body).toBeUndefined()
  })
  it.each([
    "disabled",
    "signed_out",
    "password",
    "unverified_identity",
    "other_oauth",
    "impersonation",
    "wrong_subject",
    "claims_error",
  ])("rejects %s before dispatch", async (scenario) => {
    if (scenario === "disabled") vi.stubEnv("YC_STAFF_UI_ENABLED", "false")
    if (scenario === "signed_out")
      f.user.mockResolvedValue({ data: { user: null } })
    if (scenario === "password")
      f.claims.mockResolvedValue({
        data: { claims: { sub: actor, amr: [{ method: "password" }] } },
      })
    if (scenario === "wrong_subject")
      f.claims.mockResolvedValue({
        data: { claims: { sub: id, amr: [{ method: "oauth" }] } },
      })
    if (scenario === "claims_error")
      f.claims.mockResolvedValue({ error: new Error("invalid") })
    if (scenario === "impersonation")
      f.impersonation.mockResolvedValue({ teamId: id })
    if (scenario === "unverified_identity")
      f.user.mockResolvedValue({
        data: { user: { ...user(), identities: [] } },
      })
    if (scenario === "other_oauth")
      f.claims.mockResolvedValue({
        data: {
          claims: {
            sub: actor,
            session_id: "github-session-after-unlink",
            amr: [{ method: "oauth" }],
          },
        },
      })
    await expect(getStaffClaim(id)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("rejects injected actor and invalid decision binding", async () => {
    await expect(
      decideStaffClaim(
        {
          id,
          request_id: actor,
          expected_revision: 0,
          decision: "reject",
          reason: "x",
          evidence_reference: "x",
          user_id: actor,
        },
        "use",
      ),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    [403, "forbidden"],
    [409, "conflict"],
    [503, "unavailable"],
  ])(
    "preserves failure %s without automatic write replay",
    async (status, kind) => {
      fetchMock.mockResolvedValue(
        new Response("{}", { status: Number(status) }),
      )
      await expect(getStaffClaim(id)).rejects.toMatchObject({ kind })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )
})
