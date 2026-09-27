import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Backend promotion identity and Checkout recovery contract at commit
// 4e3b32e6d39c4c24ff6a371a206bc0daf50ee802:
// api/openapi.yaml, internal/api/handlers_billing_checkout_recovery.go, and
// supabase/migrations/20260924191820_canonical_promotion_identity.sql.
const backendContract = {
  writer: "upsert_profile_with_promotion_identity",
  writerArguments: [
    "p_user_id",
    "p_email",
    "p_email_verified",
    "p_auth_updated_at",
    "p_observed_at",
  ],
  recoveryPath: "/stripe/checkout-session/recover",
  creationPath: "/stripe/checkout-session",
  unavailableCode: "checkout_recovery_unavailable",
  recovered: {
    outcome: "recovered",
    id: "cs_original",
    url: "https://checkout.stripe.test/original",
    checkout_generation: "2026-09-24T18:00:00.123456Z",
  },
} as const

function pinnedBackendFile(path: string): string {
  const fixtureDirectory = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures/promotion-checkout-contract",
  )
  return readFileSync(join(fixtureDirectory, `${path}.txt`), "utf8")
}

const calls: string[] = []
const rpc = vi.fn()
const fetchBackend = vi.fn()
vi.stubGlobal("fetch", fetchBackend)

vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (region: string) => ({
    region,
    apiBaseUrl: `https://api-${region}.test`,
    createAdminClient: () => ({
      rpc: (name: string, args: unknown) => rpc(region, name, args),
    }),
  }),
}))
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))
vi.mock("@/lib/api/proxy-auth", () => ({
  ensureAuthApiKeyForTeam: vi.fn(),
  getAuthApiKeyAndTeamForRecovery: vi.fn(),
  getAuthApiKeyAndTeamForUser: vi.fn(),
  getAuthApiKeyForUser: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: vi.fn().mockResolvedValue(null),
}))

import {
  ensureAuthApiKeyForTeam,
  getAuthApiKeyAndTeamForRecovery,
  getAuthApiKeyAndTeamForUser,
} from "@/lib/api/proxy-auth"
import { createServerClient } from "@/lib/supabase/server"

import { POST } from "./route"

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "Raw+Tag@Example.COM",
  email_confirmed_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
}

function mockCheckoutTeam(
  context: Awaited<ReturnType<typeof getAuthApiKeyAndTeamForUser>>,
) {
  vi.mocked(getAuthApiKeyAndTeamForRecovery).mockResolvedValue(context)
  vi.mocked(ensureAuthApiKeyForTeam).mockResolvedValue(context.apiKey)
}

async function checkout(
  body: Record<string, unknown> = {
    success_url: "https://console.test/success",
  },
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

describe("pinned promotion identity and Checkout recovery contract", () => {
  it("matches the pinned backend route, response, and SQL writer", () => {
    const router = pinnedBackendFile("internal/api/router.go")
    const handler = pinnedBackendFile(
      "internal/api/handlers_billing_checkout_recovery.go",
    )
    const migration = pinnedBackendFile(
      "supabase/migrations/20260924191820_canonical_promotion_identity.sql",
    )
    const openapi = pinnedBackendFile("api/openapi.yaml")

    expect(router).toContain(
      `api.POST("${backendContract.recoveryPath}", h.RecoverStripeCheckoutSession)`,
    )
    expect(handler).toContain(`"${backendContract.unavailableCode}"`)
    expect(handler).toContain('Outcome: "recovered"')
    expect(handler).toContain('json:"checkout_generation"')
    expect(handler).toContain("LockTeamBillingCheckoutForRecovery")
    expect(handler).toContain("StripeCheckoutRecoveryEvidenceAvailable")
    expect(openapi).toContain(`  ${backendContract.recoveryPath}:`)
    expect(openapi).toContain("A 409 does not prove an ambiguous create failed")
    expect(migration).toContain(
      `CREATE FUNCTION ${backendContract.writer}(${backendContract.writerArguments[0]} uuid, ${backendContract.writerArguments[1]} text,`,
    )
    expect(migration).toContain(
      `${backendContract.writerArguments[2]} boolean, ${backendContract.writerArguments[3]} timestamptz, ${backendContract.writerArguments[4]} timestamptz)`,
    )
    expect(migration).toContain("RETURN QUERY SELECT 'applied'::text")
    expect(migration).toContain("RETURN QUERY SELECT 'replayed'::text")
    expect(migration).toContain("INSERT INTO profile(id, email)")
    expect(migration).toContain("INSERT INTO promotion_identity_evidence(")
  })

  beforeEach(() => {
    calls.length = 0
    vi.mocked(getAuthApiKeyAndTeamForRecovery).mockReset()
    vi.mocked(getAuthApiKeyAndTeamForUser).mockReset()
    vi.mocked(ensureAuthApiKeyForTeam).mockReset()
    rpc.mockReset().mockImplementation(() => {
      calls.push("publish")
      return Promise.resolve({
        data: [{ outcome: "applied", evidence_version: "evidence-id" }],
        error: null,
      })
    })
    fetchBackend.mockReset().mockImplementation((url: string) => {
      if (url.endsWith(backendContract.recoveryPath)) {
        calls.push("recover")
        return Promise.resolve(
          Response.json(
            { error: { code: backendContract.unavailableCode } },
            { status: 409 },
          ),
        )
      }
      calls.push("create")
      return Promise.resolve(Response.json({ id: "cs_new" }))
    })
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: actor } }) },
    } as never)
  })

  it.each(["use", "usw"])(
    "publishes the backend writer contract in %s before creating Checkout",
    async (region) => {
      mockCheckoutTeam({
        apiKey: "ss_live_payer_key",
        team: { teamId: `team-${region}`, region },
      })
      const checkoutBody = {
        success_url: "https://console.test/success",
        cancel_url: "https://console.test/cancel",
      }

      const response = await checkout(checkoutBody, {
        "idempotency-key": "checkout-request-123",
      })
      expect(response.status).toBe(200)
      expect(calls).toEqual(["recover", "publish", "create"])
      expect(fetchBackend.mock.calls.map(([url]) => url)).toEqual([
        `https://api-${region}.test${backendContract.recoveryPath}`,
        `https://api-${region}.test${backendContract.creationPath}`,
      ])
      const [writerRegion, writerName, args] = rpc.mock.calls[0]
      expect(writerRegion).toBe(region)
      expect(writerName).toBe(backendContract.writer)
      expect(Object.keys(args).toSorted()).toEqual(
        [...backendContract.writerArguments].toSorted(),
      )
      expect(args).toMatchObject({
        p_user_id: actor.id,
        p_email: actor.email,
        p_email_verified: true,
        p_auth_updated_at: actor.updated_at,
      })
      expect(Date.parse(args.p_observed_at)).toBeGreaterThan(
        Date.now() - 60_000,
      )
      const [recoveryUrl, recoveryInit] = fetchBackend.mock.calls[0]
      expect(recoveryUrl).toContain(backendContract.recoveryPath)
      expect(recoveryInit.method).toBe("POST")
      expect(recoveryInit.body).toBe("{}")
      expect((recoveryInit.headers as Headers).get("x-api-key")).toBe(
        "ss_live_payer_key",
      )
      const [, creationInit] = fetchBackend.mock.calls[1]
      expect(creationInit.method).toBe("POST")
      expect(await new Response(creationInit.body).json()).toEqual(checkoutBody)
      const creationHeaders = creationInit.headers as Headers
      expect(creationHeaders.get("content-type")).toBe("application/json")
      expect(creationHeaders.get("idempotency-key")).toBe(
        "checkout-request-123",
      )
      expect(creationHeaders.get("x-api-key")).toBe("ss_live_payer_key")
    },
  )

  it("uses the authenticated payer in the selected cell despite creator and client identity fields", async () => {
    const creator = {
      id: "22222222-2222-4222-8222-222222222222",
      email: "creator@example.com",
    }
    const payer = {
      ...actor,
      user_metadata: { creator_id: creator.id, email: creator.email },
    }
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: payer } }) },
    } as never)
    mockCheckoutTeam({
      apiKey: "ss_live_payer_key",
      team: { teamId: "creator-owned-team", region: "usw" },
    })

    const response = await checkout(
      {
        success_url: "https://console.test/success",
        actor_id: creator.id,
        user_id: creator.id,
        email: creator.email,
      },
      { "x-api-key": "ss_live_creator_key" },
    )

    expect(response.status).toBe(200)
    expect(ensureAuthApiKeyForTeam).toHaveBeenCalledWith(
      payer,
      { teamId: "creator-owned-team", region: "usw" },
      expect.any(String),
    )
    expect(getAuthApiKeyAndTeamForUser).not.toHaveBeenCalled()
    expect(calls).toEqual(["recover", "publish", "create"])
    expect(rpc).toHaveBeenCalledWith(
      "usw",
      backendContract.writer,
      expect.objectContaining({
        p_user_id: payer.id,
        p_email: payer.email,
        p_email_verified: true,
        p_auth_updated_at: payer.updated_at,
      }),
    )
    expect(fetchBackend.mock.calls.map(([url]) => url)).toEqual([
      `https://api-usw.test${backendContract.recoveryPath}`,
      `https://api-usw.test${backendContract.creationPath}`,
    ])
    for (const [, init] of fetchBackend.mock.calls) {
      expect((init.headers as Headers).get("x-api-key")).toBe(
        "ss_live_payer_key",
      )
    }
    expect(fetchBackend.mock.calls[0][1].body).toBe("{}")
  })

  it("returns the original generation without publication or creation", async () => {
    mockCheckoutTeam({
      apiKey: "ss_live_payer_key",
      team: { teamId: "team-usw", region: "usw" },
    })
    fetchBackend.mockResolvedValueOnce(Response.json(backendContract.recovered))
    rpc.mockRejectedValue(new Error("identity authority unavailable"))

    const response = await checkout()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(backendContract.recovered)
    expect(calls).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
    expect(fetchBackend).toHaveBeenCalledTimes(1)
    expect(fetchBackend.mock.calls[0][0]).toBe(
      `https://api-usw.test${backendContract.recoveryPath}`,
    )
  })

  it.each([
    [409, "checkout_conflict"],
    [502, "bad_gateway"],
    [503, "service_unavailable"],
  ])(
    "forwards recovery %i with %s without publishing or creating Checkout",
    async (status, code) => {
      mockCheckoutTeam({
        apiKey: "ss_live_payer_key",
        team: { teamId: "team-usw", region: "usw" },
      })
      const body = JSON.stringify({
        error: { code, message: "Retry recovery" },
      })
      fetchBackend.mockResolvedValueOnce(
        new Response(body, {
          status,
          headers: {
            "content-type": "application/json",
            "x-recovery-error": code,
          },
        }),
      )

      const response = await checkout()
      expect(response.status).toBe(status)
      expect(await response.text()).toBe(body)
      expect(response.headers.get("x-recovery-error")).toBe(code)
      expect(rpc).not.toHaveBeenCalled()
      expect(fetchBackend).toHaveBeenCalledTimes(1)
      expect(fetchBackend.mock.calls[0][0]).toBe(
        `https://api-usw.test${backendContract.recoveryPath}`,
      )
    },
  )

  it("stops after a recovery network failure", async () => {
    mockCheckoutTeam({
      apiKey: "ss_live_payer_key",
      team: { teamId: "team-usw", region: "usw" },
    })
    fetchBackend.mockRejectedValueOnce(new TypeError("network unavailable"))

    const response = await checkout()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: "service_unavailable",
        message: "Checkout recovery unavailable",
      },
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(fetchBackend).toHaveBeenCalledTimes(1)
    expect(fetchBackend.mock.calls[0][0]).toBe(
      `https://api-usw.test${backendContract.recoveryPath}`,
    )
  })

  it.each(["writer failure", "older cell"])(
    "does not create after %s",
    async (failure) => {
      mockCheckoutTeam({
        apiKey: "ss_live_payer_key",
        team: { teamId: "team-usw", region: "usw" },
      })
      if (failure === "writer failure") {
        rpc.mockResolvedValueOnce({ data: null, error: { code: "55000" } })
      } else {
        fetchBackend.mockResolvedValueOnce(new Response(null, { status: 404 }))
      }

      const response = await checkout()
      expect(response.status).toBe(failure === "writer failure" ? 503 : 404)
      expect(calls).toEqual(failure === "writer failure" ? ["recover"] : [])
      expect(fetchBackend).toHaveBeenCalledTimes(1)
      expect(fetchBackend.mock.calls[0][0]).toBe(
        `https://api-usw.test${backendContract.recoveryPath}`,
      )
    },
  )
})
