/**
 * API proxy tests — exercises the catch-all that forwards browser requests
 * to the sandbox API. Covers:
 *  - Allowed prefix list vs 404
 *  - X-API-Key injection for authenticated requests
 *  - SKIP_KEY_INJECTION (v1/auth/ — no key, client Authorization preserved)
 *  - Header allowlist: cookie, x-api-key from client are stripped
 *  - 204/205/304 null-body handling
 *  - 401 when not authenticated
 */

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mocks declared BEFORE the module under test is imported.
vi.mock("@/lib/api/proxy-auth", () => ({
  ensureAuthApiKeyForTeam: vi.fn(),
  getAuthApiKeyAndTeamForRecovery: vi.fn(),
  getAuthApiKeyAndTeamForUser: vi.fn(),
  getAuthApiKeyForUser: vi.fn(),
  repairRecoveryAuthApiKeyForTeam: vi.fn(),
}))
vi.mock("@/lib/api/promotion-identity", () => ({
  publishPromotionIdentity: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: vi.fn(),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (region: string) => ({
    region,
    apiBaseUrl:
      region === "use"
        ? "https://api.test.superserve.ai"
        : `https://api-${region}.test`,
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))

// Global fetch spy — upstream responses are crafted per test.
const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

// SANDBOX_API_URL is pre-stubbed in src/test/setup.ts; the route reads it at module load.

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { previewPlanChange, schedulePlanChange } from "@/lib/api/plan-changes"
import { publishPromotionIdentity } from "@/lib/api/promotion-identity"
import {
  ensureAuthApiKeyForTeam,
  getAuthApiKeyAndTeamForRecovery,
  getAuthApiKeyAndTeamForUser,
  getAuthApiKeyForUser,
  repairRecoveryAuthApiKeyForTeam,
} from "@/lib/api/proxy-auth"
import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"
import { createServerClient } from "@/lib/supabase/server"
import consentWire from "@/test/fixtures/billing-plan-change-wire.json"

import { DELETE, GET, POST, PUT } from "./route"

type AnyParams = { params: Promise<{ path: string[] }> }

function req(
  method: string,
  pathSegments: string[],
  init: { headers?: Record<string, string>; body?: BodyInit } = {},
): NextRequest {
  const url = new URL(`https://console.test/api/${pathSegments.join("/")}`)
  return new NextRequest(url, {
    method,
    headers: init.headers,
    body: init.body,
  })
}

function params(pathSegments: string[]): AnyParams {
  return { params: Promise.resolve({ path: pathSegments }) }
}

describe("api proxy /api/[...path]", () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    vi.mocked(createServerClient).mockClear()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    } as never)
    vi.mocked(getAuthApiKeyForUser).mockReset()
    vi.mocked(getAuthApiKeyForUser).mockResolvedValue("ss_live_test_key")
    vi.mocked(getAuthApiKeyAndTeamForUser)
      .mockReset()
      .mockResolvedValue({
        apiKey: "ss_live_test_key",
        team: { teamId: "team-east", region: "use" },
      })
    vi.mocked(getAuthApiKeyAndTeamForRecovery)
      .mockReset()
      .mockResolvedValue({
        apiKey: "ss_live_test_key",
        team: { teamId: "team-east", region: "use" },
      })
    vi.mocked(ensureAuthApiKeyForTeam)
      .mockReset()
      .mockResolvedValue("ss_live_test_key")
    vi.mocked(repairRecoveryAuthApiKeyForTeam)
      .mockReset()
      .mockResolvedValue("ss_live_test_key")
    vi.mocked(publishPromotionIdentity).mockReset().mockResolvedValue()
    vi.mocked(getImpersonationContext).mockReset()
    vi.mocked(getImpersonationContext).mockResolvedValue(null)
  })

  it("forwards team capabilities only through authenticated billing reads", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ schema_version: 1 }), { status: 200 }),
    )
    const path = ["billing", "capabilities"]
    const response = await GET(req("GET", path), params(path))
    expect(response.status).toBe(200)
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/billing/capabilities")
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as never)
    fetchSpy.mockClear()
    const denied = await GET(req("GET", path), params(path))
    expect(denied.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns 404 for a path outside the allowed prefixes", async () => {
    const res = await GET(req("GET", ["unknown"]), params(["unknown"]))
    expect(res.status).toBe(404)
  })

  it("forwards only the selected Pro offer and owned return URLs, never client price IDs", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ url: "https://checkout.stripe.com/session" }),
        { status: 200 },
      ),
    )
    const path = ["stripe", "pro-checkout"]
    const res = await POST(
      req("POST", path, {
        body: JSON.stringify({
          expected_team: "use:team-east",
          offer: "pro_annual",
          operation_id: "11111111-1111-4111-8111-111111111111",
          price_id: "attacker-price",
          success_url: "https://console.test/onboarding/plan/?billing=success",
          cancel_url: "https://console.test/onboarding/plan/?billing=cancel",
        }),
      }),
      params(path),
    )
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.test.superserve.ai/stripe/checkout-session")
    expect(JSON.parse(init.body)).toEqual({
      offer: "pro_annual",
      operation_id: "11111111-1111-4111-8111-111111111111",
      success_url: "https://console.test/onboarding/plan/?billing=success",
      cancel_url: "https://console.test/onboarding/plan/?billing=cancel",
    })
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
  })

  it.each(["plan-choice", "pro-checkout", "pro-checkout/recover"])(
    "rejects a stale team's %s request before dispatch",
    async (suffix) => {
      const path = ["stripe", ...suffix.split("/")]
      const res = await POST(
        req("POST", path, {
          body: JSON.stringify({
            expected_team: "usw:old-team",
            offer: "free",
            restart: true,
          }),
        }),
        params(path),
      )
      expect(res.status).toBe(409)
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it("preserves the backend's uncertain-payment outcome and accepts only explicit recovery intent", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ outcome: "payment_confirmation_pending" }),
        { status: 202 },
      ),
    )
    const path = ["stripe", "pro-checkout", "recover"]
    const res = await POST(
      req("POST", path, {
        body: JSON.stringify({
          expected_team: "use:team-east",
          restart: true,
          offer: "free",
        }),
      }),
      params(path),
    )
    expect(res.status).toBe(202)
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      restart: true,
    })
    expect(await res.json()).toEqual({
      outcome: "payment_confirmation_pending",
    })
  })

  it("does not allow plan mutation during impersonation", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "other",
      region: "usw",
    } as never)
    const path = ["stripe", "plan-choice"]
    expect(
      (
        await POST(
          req("POST", path, {
            body: JSON.stringify({ expected_team: "usw:other", offer: "free" }),
          }),
          params(path),
        )
      ).status,
    ).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("accepts dashboard Pro returns only for the pinned checkout team", async () => {
    const path = ["stripe", "pro-checkout"]
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ url: "https://checkout.stripe.com/session" }),
        { status: 200 },
      ),
    )
    for (const team of ["use:team-east", "use:other-team"]) {
      const target = `https://console.test/billing/pro/?team=${encodeURIComponent(team)}`
      const response = await POST(
        req("POST", path, {
          body: JSON.stringify({
            expected_team: "use:team-east",
            offer: "pro_monthly",
            success_url: target,
            cancel_url: target,
          }),
        }),
        params(path),
      )
      expect(response.status).toBe(team === "use:team-east" ? 200 : 400)
    }
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it("rejects arbitrary offers and cross-origin payment returns", async () => {
    const path = ["stripe", "pro-checkout"]
    for (const body of [
      {
        offer: "yc_2026",
        success_url: "https://console.test/onboarding/plan/",
        cancel_url: "https://console.test/onboarding/plan/",
      },
      {
        offer: "pro_monthly",
        success_url: "https://other.test/onboarding/plan/",
        cancel_url: "https://console.test/onboarding/plan/",
      },
    ])
      expect(
        (
          await POST(
            req("POST", path, {
              body: JSON.stringify({ expected_team: "use:team-east", ...body }),
            }),
            params(path),
          )
        ).status,
      ).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("forwards the snapshots prefix", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))

    const path = ["snapshots", "snap-1"]
    const res = await GET(req("GET", path), params(path))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.test.superserve.ai/snapshots/snap-1",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it.each([
    ["v1/..%2Fstripe%2Fcheckout-session", ["v1", "../stripe/checkout-session"]],
    [
      "sandboxes%2F..%2Fstripe%2Fcheckout-session",
      ["sandboxes/../stripe/checkout-session"],
    ],
    [
      "sandboxes/%2e%2e/stripe/checkout-session",
      ["sandboxes", "%2e%2e", "stripe", "checkout-session"],
    ],
    [
      "sandboxes/%252e%252e/stripe/checkout-session",
      ["sandboxes", "%2e%2e", "stripe", "checkout-session"],
    ],
    [
      "sandboxes/%09../stripe/checkout-session",
      ["sandboxes", "\t..", "stripe", "checkout-session"],
    ],
    [
      "v1/auth/device%5C..%5C..%5Cstripe%5Ccheckout-session",
      ["v1", "auth", "device\\..\\..\\stripe\\checkout-session"],
    ],
  ])(
    "rejects encoded path traversal before proxying: %s",
    async (encodedPath, decodedPath) => {
      vi.mocked(publishPromotionIdentity).mockRejectedValue(
        new Error("publication unavailable"),
      )
      const res = await POST(
        req("POST", [encodedPath], { body: "{}" }),
        params(decodedPath),
      )

      expect(res.status).toBe(404)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(publishPromotionIdentity).not.toHaveBeenCalled()
      expect(createServerClient).not.toHaveBeenCalled()
    },
  )

  it("keeps ordinary encoded resource names routable", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
    const res = await DELETE(
      req("DELETE", ["sandboxes", "sbx-1", "secrets", "A%20B"]),
      params(["sandboxes", "sbx-1", "secrets", "A B"]),
    )

    expect(res.status).toBe(204)
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.test.superserve.ai/sandboxes/sbx-1/secrets/A%20B",
    )
  })

  it("forwards the billing usage-series endpoint", async () => {
    vi.mocked(publishPromotionIdentity).mockRejectedValue(
      new Error("writer unavailable"),
    )
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))

    const request = new NextRequest(
      new URL(
        "https://console.test/api/billing/usage-series?start=2026-01-01T00%3A00%3A00.000Z&end=2026-01-02T00%3A00%3A00.000Z&granularity=hour&timezone=UTC",
      ),
      { method: "GET" },
    )
    const res = await GET(request, params(["billing", "usage-series"]))

    expect(res.status).toBe(200)
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.test.superserve.ai/billing/usage-series?start=2026-01-01T00%3A00%3A00.000Z&end=2026-01-02T00%3A00%3A00.000Z&granularity=hour&timezone=UTC",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("forwards the plan, allowance and balance reads, GET only", async () => {
    vi.mocked(publishPromotionIdentity).mockRejectedValue(
      new Error("writer unavailable"),
    )
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "cache-control": "max-age=300" },
        }),
      ),
    )
    for (const path of [
      ["billing", "plans", "public"],
      ["billing", "plan"],
      ["billing", "free-allowance"],
      ["billing", "prepaid"],
    ]) {
      const res = await GET(req("GET", path), params(path))
      expect(res.status).toBe(200)
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      expect(fetchSpy).toHaveBeenLastCalledWith(
        `https://api.test.superserve.ai/${path.join("/")}`,
        expect.objectContaining({ method: "GET" }),
      )
      const write = await POST(req("POST", path), params(path))
      expect(write.status).toBe(405)
    }
    for (const path of [
      ["billing", "plans"],
      ["billing", "plan", "x"],
      ["billing", "prepaid", "recharge"],
    ]) {
      const res = await GET(req("GET", path), params(path))
      expect(res.status).toBe(404)
    }
  })

  it.each([
    ["delayed", consentWire],
    ["immediate", consentWire.immediate],
  ])(
    "round-trips a backend-captured %s preview into its accepted consent DTO",
    async (_, wire) => {
      vi.mocked(getAuthApiKeyAndTeamForUser).mockResolvedValue({
        apiKey: "ss_live_test_key",
        team: { teamId: wire.team_id, region: "use" },
      } as never)
      let upstreamWrites = 0
      fetchSpy.mockImplementation(
        async (input: string, init: RequestInit = {}) => {
          if (input.startsWith("/api/")) {
            const url = new URL(input, "https://console.test")
            const path = url.pathname.split("/").filter(Boolean).slice(1)
            const request = new NextRequest(url, {
              ...init,
              signal: init.signal ?? undefined,
            })
            return (init.method === "POST" ? POST : GET)(request, params(path))
          }
          const url = new URL(input)
          expect(url.origin).toBe("https://api.test.superserve.ai")
          if (url.pathname === "/billing/plan-change-preview") {
            expect(url.search).toBe("?target_plan=free")
            return new Response(JSON.stringify(wire.preview))
          }
          expect(url.pathname).toBe("/billing/plan-changes")
          expect(init.method).toBe("POST")
          expect(JSON.parse(init.body as string)).toEqual(wire.accepted_request)
          upstreamWrites++
          return new Response(JSON.stringify(wire.change))
        },
      )
      const expectedTeam = `use:${wire.team_id}`
      const preview = await previewPlanChange("free", expectedTeam)
      expect(preview.preview_token).toBe(wire.preview.preview_token)
      const result = await schedulePlanChange(
        preview.target_plan_key,
        expectedTeam,
        wire.accepted_request.idempotency_key,
        preview.preview_token!,
        preview.pauses_running,
        preview.timing === "end_of_billing_period"
          ? preview.effective_at
          : undefined,
      )
      expect(result).toEqual(wire.change)
      expect(upstreamWrites).toBe(1)
    },
  )

  it("forwards bound previews and writes on the actual customer paths", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    )
    const preview = ["billing", "plan-change-preview"]
    const previewRequest = new NextRequest(
      "https://console.test/api/billing/plan-change-preview?target_plan=free&expected_team=use%3Ateam-east",
    )
    expect((await GET(previewRequest, params(preview))).status).toBe(200)
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://api.test.superserve.ai/billing/plan-change-preview?target_plan=free",
      expect.objectContaining({ method: "GET" }),
    )
    expect((await POST(req("POST", preview), params(preview))).status).toBe(405)
    const paths = [
      ["billing", "plan-changes"],
      [
        "billing",
        "plan-changes",
        "34971786-dd50-492b-b934-306b63764c4b",
        "undo",
      ],
    ]
    for (const path of paths) {
      const body = JSON.stringify({
        expected_team: "use:team-east",
        target_plan: "free",
        expected_effective_at: "2026-11-01T00:00:00.123456789Z",
        target: "discard-this-alias",
        preview_token: "a".repeat(64),
        confirm_pauses_running: true,
        idempotency_key: "request-1",
        ignored: true,
      })
      expect(
        (await POST(req("POST", path, { body }), params(path))).status,
      ).toBe(200)
      expect(fetchSpy).toHaveBeenLastCalledWith(
        `https://api.test.superserve.ai/${path.join("/")}`,
        expect.objectContaining({
          method: "POST",
          body:
            path.length === 2
              ? JSON.stringify({
                  target_plan: "free",
                  idempotency_key: "request-1",
                  preview_token: "a".repeat(64),
                  expected_effective_at: "2026-11-01T00:00:00.123456789Z",
                  confirm_pauses_running: true,
                })
              : "{}",
        }),
      )
      expect((await GET(req("GET", path), params(path))).status).toBe(405)
      expect((await DELETE(req("DELETE", path), params(path))).status).toBe(405)
    }
  })

  it.each([undefined, "use:previous-team"])(
    "rejects missing or stale team binding: %s",
    async (expectedTeam) => {
      const preview = ["billing", "plan-change-preview"]
      const request = new NextRequest(
        `https://console.test/api/billing/plan-change-preview?target_plan=free${expectedTeam ? `&expected_team=${encodeURIComponent(expectedTeam)}` : ""}`,
      )
      expect((await GET(request, params(preview))).status).toBe(409)
      for (const path of [
        ["billing", "plan-changes"],
        [
          "billing",
          "plan-changes",
          "34971786-dd50-492b-b934-306b63764c4b",
          "undo",
        ],
      ]) {
        expect(
          (
            await POST(
              req("POST", path, {
                body: JSON.stringify({ expected_team: expectedTeam }),
              }),
              params(path),
            )
          ).status,
        ).toBe(409)
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it("forwards the authenticated billing pricing endpoint", async () => {
    vi.mocked(publishPromotionIdentity).mockRejectedValue(
      new Error("writer unavailable"),
    )
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ rates: [] }), { status: 200 }),
    )

    const res = await GET(
      req("GET", ["billing", "pricing"]),
      params(["billing", "pricing"]),
    )

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.test.superserve.ai/billing/pricing",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("forwards the secrets, providers, activity, and billing prefixes", async () => {
    vi.mocked(publishPromotionIdentity).mockRejectedValue(
      new Error("writer unavailable"),
    )
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    for (const path of [
      ["secrets"],
      ["secrets", "my_key"],
      ["providers"],
      ["activity"],
    ]) {
      const res = await GET(req("GET", path), params(path))
      expect(res.status).toBe(200)
    }
    const billingRes = await GET(
      req("GET", ["billing", "summary"]),
      params(["billing", "summary"]),
    )
    expect(billingRes.status).toBe(200)
    expect(billingRes.headers.get("cache-control")).toBe("private, no-store")
    expect(fetchSpy).toHaveBeenCalledTimes(5)
    expect(fetchSpy.mock.calls[4][0]).toBe(
      "https://api.test.superserve.ai/billing/summary",
    )

    const teamBillingRes = await GET(
      req("GET", ["teams", "team-a", "billing", "usage"]),
      params(["teams", "team-a", "billing", "usage"]),
    )
    expect(teamBillingRes.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(6)
    expect(fetchSpy.mock.calls[5][0]).toBe(
      "https://api.test.superserve.ai/teams/team-a/billing/usage",
    )

    const exportPreviewRes = await GET(
      req("GET", [
        "teams",
        "team-a",
        "billing",
        "periods",
        "period-1",
        "export-preview",
      ]),
      params([
        "teams",
        "team-a",
        "billing",
        "periods",
        "period-1",
        "export-preview",
      ]),
    )
    expect(exportPreviewRes.status).toBe(200)
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(7)
    expect(fetchSpy.mock.calls[6][0]).toBe(
      "https://api.test.superserve.ai/teams/team-a/billing/periods/period-1/export-preview",
    )

    vi.mocked(publishPromotionIdentity).mockResolvedValue()
    fetchSpy.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/stripe/checkout-session/recover")
          ? new Response(
              JSON.stringify({
                error: { code: "checkout_recovery_unavailable" },
              }),
              { status: 409, headers: { "content-type": "application/json" } },
            )
          : new Response("[]", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
      ),
    )
    const stripeRes = await POST(
      req("POST", ["stripe", "checkout-session"], {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success_url: "https://console.test/success",
          cancel_url: "https://console.test/cancel",
        }),
      }),
      params(["stripe", "checkout-session"]),
    )
    expect(stripeRes.status).toBe(409)
    expect((await stripeRes.json()).error.code).toBe("checkout_intent_required")
    expect(fetchSpy).toHaveBeenCalledTimes(8)
    expect(publishPromotionIdentity).not.toHaveBeenCalled()

    vi.mocked(publishPromotionIdentity)
      .mockClear()
      .mockRejectedValue(new Error("writer unavailable"))
    const portalRes = await POST(
      req("POST", ["stripe", "customer-portal-session"], {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          return_url: "https://console.test/plan-usage",
        }),
      }),
      params(["stripe", "customer-portal-session"]),
    )
    expect(portalRes.status).toBe(200)
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(9)
    expect(fetchSpy.mock.calls[8][0]).toBe(
      "https://api.test.superserve.ai/stripe/customer-portal-session",
    )
  })

  it("returns pinned recovery without publishing fresh identity", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          outcome: "recovered",
          id: "cs_1",
          url: "https://stripe.test",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.mocked(publishPromotionIdentity).mockRejectedValue(
      new Error("unavailable"),
    )
    const res = await POST(
      req("POST", ["stripe", "checkout-session"], { body: "{}" }),
      params(["stripe", "checkout-session"]),
    )
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.test.superserve.ai/stripe/checkout-session/recover",
    )
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(getAuthApiKeyAndTeamForUser).not.toHaveBeenCalled()
    expect(getAuthApiKeyAndTeamForRecovery).toHaveBeenCalledTimes(1)
  })

  it("retries later when Checkout membership cannot be resolved", async () => {
    vi.mocked(getAuthApiKeyAndTeamForRecovery).mockRejectedValueOnce(
      new Error("Checkout membership lookup incomplete; please retry"),
    )

    const res = await POST(
      req("POST", ["stripe", "checkout-session"], { body: "{}" }),
      params(["stripe", "checkout-session"]),
    )

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: {
        code: "service_unavailable",
        message: "Checkout membership unavailable; please retry",
      },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(repairRecoveryAuthApiKeyForTeam).not.toHaveBeenCalled()
  })

  it.each(["selected team missing", "selected cell changed"])(
    "rejects Checkout when the %s",
    async (mismatch) => {
      vi.mocked(getAuthApiKeyAndTeamForRecovery).mockRejectedValueOnce(
        new Error(`Checkout ${mismatch} membership unavailable`),
      )

      const res = await POST(
        req("POST", ["stripe", "checkout-session"], { body: "{}" }),
        params(["stripe", "checkout-session"]),
      )

      expect(res.status).toBe(503)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(repairRecoveryAuthApiKeyForTeam).not.toHaveBeenCalled()
      expect(ensureAuthApiKeyForTeam).not.toHaveBeenCalled()
      expect(publishPromotionIdentity).not.toHaveBeenCalled()
    },
  )

  it("recovers a pinned Checkout when regional profile repair would fail", async () => {
    vi.mocked(getAuthApiKeyAndTeamForUser).mockRejectedValue(
      new Error("promotion writer unavailable"),
    )
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ outcome: "recovered", id: "cs_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const res = await POST(
      req("POST", ["stripe", "checkout-session"], { body: "{}" }),
      params(["stripe", "checkout-session"]),
    )

    expect(res.status).toBe(200)
    expect(getAuthApiKeyAndTeamForUser).not.toHaveBeenCalled()
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("repairs a missing key after recovery auth fails and retries recovery", async () => {
    vi.mocked(publishPromotionIdentity).mockRejectedValue(
      new Error("writer unavailable"),
    )
    vi.mocked(getAuthApiKeyAndTeamForUser).mockRejectedValue(
      new Error("membership disappeared after recovery lookup"),
    )
    fetchSpy
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ outcome: "recovered", id: "cs_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

    const res = await POST(
      req("POST", ["stripe", "checkout-session"], { body: "{}" }),
      params(["stripe", "checkout-session"]),
    )

    expect(res.status).toBe(200)
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(ensureAuthApiKeyForTeam).not.toHaveBeenCalled()
    expect(repairRecoveryAuthApiKeyForTeam).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      { teamId: "team-east", region: "use" },
    )
    expect(getAuthApiKeyAndTeamForUser).not.toHaveBeenCalled()
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "https://api.test.superserve.ai/stripe/checkout-session/recover",
      "https://api.test.superserve.ai/stripe/checkout-session/recover",
    ])
  })

  it("stops Checkout when key repair resolves a different key", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("unauthorized", { status: 401 }),
    )
    vi.mocked(repairRecoveryAuthApiKeyForTeam).mockResolvedValueOnce(
      "ss_live_different_key",
    )

    const res = await POST(
      req("POST", ["stripe", "checkout-session"], { body: "{}" }),
      params(["stripe", "checkout-session"]),
    )

    expect(res.status).toBe(503)
    expect(repairRecoveryAuthApiKeyForTeam).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      { teamId: "team-east", region: "use" },
    )
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "https://api.test.superserve.ai/stripe/checkout-session/recover",
    ])
  })

  it("does not start Checkout when recovery authentication repair fails", async () => {
    fetchSpy.mockResolvedValue(new Response("unauthorized", { status: 401 }))
    vi.mocked(repairRecoveryAuthApiKeyForTeam).mockRejectedValue(
      new Error("profile repair unavailable"),
    )

    const res = await POST(
      req("POST", ["stripe", "checkout-session"], { body: "{}" }),
      params(["stripe", "checkout-session"]),
    )

    expect(res.status).toBe(503)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(repairRecoveryAuthApiKeyForTeam).toHaveBeenCalledTimes(1)
    expect(getAuthApiKeyAndTeamForUser).not.toHaveBeenCalled()
  })

  it("preserves recovery authorization failure when the key is already ready", async () => {
    fetchSpy.mockResolvedValue(new Response("unauthorized", { status: 401 }))

    const res = await POST(
      req("POST", ["stripe", "checkout-session"], { body: "{}" }),
      params(["stripe", "checkout-session"]),
    )

    expect(res.status).toBe(401)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
  })

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as never)
    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns a generic 403 when first-team provisioning is restricted", async () => {
    vi.mocked(getAuthApiKeyAndTeamForUser).mockRejectedValue(
      new SignupRestrictedError(),
    )
    const response = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: "signup_blocked",
        message: "Signup is not available. Please try again later.",
      },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("injects X-API-Key on authenticated requests to /sandboxes", async () => {
    vi.mocked(publishPromotionIdentity).mockRejectedValue(
      new Error("writer unavailable"),
    )
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: "s1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))

    expect(res.status).toBe(200)
    expect(publishPromotionIdentity).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, fetchInit] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.test.superserve.ai/sandboxes")
    const headers = fetchInit.headers as Headers
    expect(headers.get("x-api-key")).toBe("ss_live_test_key")
  })

  it("forwards query params unchanged", async () => {
    fetchSpy.mockResolvedValue(new Response("[]", { status: 200 }))
    const request = new NextRequest(
      new URL("https://console.test/api/sandboxes?status=active&q=foo"),
      { method: "GET" },
    )
    await GET(request, params(["sandboxes"]))
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "https://api.test.superserve.ai/sandboxes?status=active&q=foo",
    )
  })

  it("overrides forwarded team_id while impersonating", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "impersonated-team",
      region: "usw",
      teamName: "Impersonated Team",
    })
    fetchSpy.mockResolvedValue(new Response("[]", { status: 200 }))
    const request = new NextRequest(
      new URL("https://console.test/api/templates?team_id=admin-team&owner=me"),
      { method: "GET" },
    )

    await GET(request, params(["templates"]))

    expect(getAuthApiKeyForUser).toHaveBeenCalledWith(
      { id: "u1" },
      {
        teamId: "impersonated-team",
        region: "usw",
        teamName: "Impersonated Team",
      },
      expect.any(String),
    )
    expect(getAuthApiKeyAndTeamForUser).not.toHaveBeenCalled()
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "https://api-usw.test/templates?team_id=impersonated-team&owner=me",
    )
    const [, fetchInit] = fetchSpy.mock.calls[0]
    const headers = fetchInit.headers as Headers
    expect(headers.get("x-api-key")).toBe("ss_live_test_key")
  })

  it("blocks writes while impersonating", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "impersonated-team",
      region: "usw",
      teamName: "Impersonated Team",
    })

    const res = await POST(
      req("POST", ["templates"], {
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      params(["templates"]),
    )

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "read_only_impersonation" },
    })
  })

  it("skips X-API-Key injection on /v1/auth/ paths and preserves Authorization", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
    await POST(
      req("POST", ["v1", "auth", "device"], {
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      params(["v1", "auth", "device"]),
    )
    const [, fetchInit] = fetchSpy.mock.calls[0]
    const headers = fetchInit.headers as Headers
    expect(headers.get("x-api-key")).toBeNull()
    expect(headers.get("authorization")).toBe("Bearer user-token")
  })

  it("refuses an account awaiting Enterprise setup", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: {
            user: { id: "u1", app_metadata: { signup_review: "pending" } },
          },
        }),
      },
    } as never)
    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("forwards CLI authorisation for an unmarked account", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
    const getUser = vi.fn(async () => ({
      data: { user: { id: "u1", app_metadata: {} } },
      error: null,
    }))
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser },
    } as never)
    await POST(
      req("POST", ["v1", "auth", "device-authorize"], {
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      params(["v1", "auth", "device-authorize"]),
    )
    expect(getUser).toHaveBeenCalledWith("user-token")
    expect(fetchSpy).toHaveBeenCalled()
  })

  it("refuses a CLI authorisation for an account awaiting Enterprise setup", async () => {
    const getUser = vi.fn(async () => ({
      data: { user: { id: "u1", app_metadata: { signup_review: "pending" } } },
      error: null,
    }))
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser },
    } as never)
    const res = await POST(
      req("POST", ["v1", "auth", "device-authorize"], {
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      params(["v1", "auth", "device-authorize"]),
    )
    expect(getUser).toHaveBeenCalledWith("user-token")
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toHaveProperty("detail")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects an explicitly invalid CLI bearer without forwarding it", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 401 }))
    vi.mocked(createServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 401, code: "bad_jwt", message: "bad jwt" },
        }),
      },
    } as never)
    const res = await POST(
      req("POST", ["v1", "auth", "device-authorize"], {
        headers: {
          authorization: "Bearer stale-token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      params(["v1", "auth", "device-authorize"]),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(res.status).toBe(401)
  })

  it.each([429, 503, "throw", "missing_user"])(
    "does not authorize a CLI bearer when Auth lookup fails with %s",
    async (failure) => {
      const getUser = vi.fn(async () => {
        if (failure === "throw") throw new Error("lookup timed out")
        return {
          data: { user: null },
          error:
            typeof failure === "number"
              ? { status: failure, message: "unavailable" }
              : null,
        }
      })
      vi.mocked(createServerClient).mockResolvedValue({
        auth: { getUser },
      } as never)
      const res = await POST(
        req("POST", ["v1", "auth", "device-authorize"], {
          headers: {
            authorization: "Bearer user-token",
            "content-type": "application/json",
          },
          body: "{}",
        }),
        params(["v1", "auth", "device-authorize"]),
      )
      expect(res.status).toBe(503)
      expect(res.headers.get("retry-after")).toBe("5")
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it("strips disallowed client-supplied headers (cookie, x-api-key)", async () => {
    fetchSpy.mockResolvedValue(new Response("[]", { status: 200 }))
    await GET(
      req("GET", ["sandboxes"], {
        headers: {
          cookie: "sb-access-token=leaked",
          "x-api-key": "ss_live_attacker",
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
      }),
      params(["sandboxes"]),
    )
    const [, fetchInit] = fetchSpy.mock.calls[0]
    const headers = fetchInit.headers as Headers
    expect(headers.get("cookie")).toBeNull()
    // Our server-side key wins, not the attacker's.
    expect(headers.get("authorization")).toBeNull()
    expect(headers.get("x-api-key")).toBe("ss_live_test_key")
    // Allowlisted header still forwarded.
    expect(headers.get("content-type")).toBe("application/json")
  })

  it("handles 204 No Content without crashing on body", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
    const res = await DELETE(
      req("DELETE", ["sandboxes", "abc"]),
      params(["sandboxes", "abc"]),
    )
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")
  })

  it("handles 304 Not Modified without body", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 304 }))
    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))
    expect(res.status).toBe(304)
  })

  it("forwards request body for non-GET methods", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
    await PUT(
      req("PUT", ["sandboxes", "abc"], {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
      params(["sandboxes", "abc"]),
    )
    const [, fetchInit] = fetchSpy.mock.calls[0]
    expect(fetchInit.method).toBe("PUT")
    const body = fetchInit.body as ArrayBuffer
    expect(body.byteLength).toBeGreaterThan(0)
  })

  it("forwards response status, content-type, and body for normal 200s", async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"id":"abc"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const res = await GET(
      req("GET", ["sandboxes", "abc"]),
      params(["sandboxes", "abc"]),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(await res.json()).toEqual({ id: "abc" })
  })

  it("preserves access_token in sandbox responses", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", access_token: "keep-me" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const res = await GET(
      req("GET", ["sandboxes", "abc"]),
      params(["sandboxes", "abc"]),
    )
    expect((await res.json()).access_token).toBe("keep-me")
  })

  it("redacts access tokens during impersonation", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "impersonated-team",
      region: "usw",
      teamName: "Impersonated Team",
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", access_token: "keep-me" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const res = await GET(
      req("GET", ["sandboxes", "abc"]),
      params(["sandboxes", "abc"]),
    )

    expect((await res.json()).access_token).toBeUndefined()
  })
})

describe("api proxy prepaid credit", () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    } as never)
    vi.mocked(getImpersonationContext).mockResolvedValue(null)
  })

  it("forwards only the purchase fields for the active team", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.com/s" }), {
        status: 200,
      }),
    )
    const path = ["billing", "prepaid", "checkout"]
    const res = await POST(
      req("POST", path, {
        body: JSON.stringify({
          expected_team: "use:team-east",
          operation_id: "e2f2a080-167c-4cb0-8fb1-093be9e7720a",
          amount_cents: 2500,
          success_url: "https://console.test/plan-usage/buy-credit/",
          cancel_url: "https://console.test/plan-usage/buy-credit/",
          customer: "cus_attacker",
        }),
      }),
      params(path),
    )
    expect(res.status).toBe(200)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.test.superserve.ai/billing/prepaid/checkout")
    expect(JSON.parse(init.body)).toEqual({
      operation_id: "e2f2a080-167c-4cb0-8fb1-093be9e7720a",
      amount_cents: 2500,
      success_url: "https://console.test/plan-usage/buy-credit/",
      cancel_url: "https://console.test/plan-usage/buy-credit/",
    })
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })

  it.each([
    ["checkout", POST],
    ["auto-recharge", PUT],
  ] as const)(
    "normalizes rewritten %s body headers",
    async (suffix, handler) => {
      fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
      const path = ["billing", "prepaid", suffix]
      const body = JSON.stringify({
        expected_team: "use:team-east",
        amount_cents: 500,
        enabled: false,
        success_url:
          "https://console.test/plan-usage/buy-credit?purchase=success",
        cancel_url:
          "https://console.test/plan-usage/buy-credit/?purchase=cancel",
      })
      const res = await handler(
        req(suffix === "checkout" ? "POST" : "PUT", path, {
          body,
          headers: {
            "content-length": String(Buffer.byteLength(body)),
            "content-type": "text/plain",
          },
        }),
        params(path),
      )
      expect(res.status).toBe(200)
      const init = fetchSpy.mock.calls[0][1]
      expect(init.headers.has("content-length")).toBe(false)
      expect(init.headers.get("content-type")).toBe("application/json")
      expect(JSON.parse(init.body)).not.toHaveProperty("expected_team")
      expect(init.body.length).toBeLessThan(body.length)
    },
  )

  it.each([
    [
      "https://other.test/plan-usage/buy-credit",
      "https://console.test/plan-usage/buy-credit",
    ],
    [
      "https://console.test/plan-usage/buy-credit",
      "https://other.test/plan-usage/buy-credit",
    ],
    [
      "https://console.test/plan-usage",
      "https://console.test/plan-usage/buy-credit",
    ],
    [
      "https://console.test/plan-usage/buy-credit",
      "https://console.test/onboarding/plan",
    ],
    ["invalid", "https://console.test/plan-usage/buy-credit"],
    [undefined, "https://console.test/plan-usage/buy-credit"],
    ["https://console.test/plan-usage/buy-credit", undefined],
  ])(
    "rejects unowned prepaid payment returns %s / %s",
    async (success_url, cancel_url) => {
      const path = ["billing", "prepaid", "checkout"]
      const res = await POST(
        req("POST", path, {
          body: JSON.stringify({
            expected_team: "use:team-east",
            amount_cents: 500,
            success_url,
            cancel_url,
          }),
        }),
        params(path),
      )
      expect(res.status).toBe(400)
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["billing/prepaid/checkout", "POST"],
    ["billing/prepaid/checkout/recover", "POST"],
    ["billing/prepaid/auto-recharge", "PUT"],
  ])("rejects a stale team's %s request before dispatch", async (p, method) => {
    const path = p.split("/")
    const handler = method === "PUT" ? PUT : POST
    const res = await handler(
      req(method, path, {
        body: JSON.stringify({ expected_team: "usw:old-team", enabled: false }),
      }),
      params(path),
    )
    expect(res.status).toBe(409)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("allows each prepaid path only with its own method", async () => {
    for (const [p, method, handler] of [
      ["billing/prepaid", "POST", POST],
      ["billing/prepaid/checkout", "GET", GET],
      ["billing/prepaid/checkout/recover", "GET", GET],
      ["billing/prepaid/checkout/recover", "PUT", PUT],
      ["billing/prepaid/auto-recharge", "POST", POST],
      ["billing/prepaid/auto-recharge", "DELETE", DELETE],
    ] as const) {
      const path = p.split("/")
      const res = await handler(req(method, path), params(path))
      expect(res.status).toBe(405)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("does not allow prepaid writes during impersonation", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "team-west",
      region: "usw",
    } as never)
    const path = ["billing", "prepaid", "auto-recharge"]
    const res = await PUT(
      req("PUT", path, {
        body: JSON.stringify({
          expected_team: "usw:team-west",
          enabled: false,
        }),
      }),
      params(path),
    )
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("pending Starter checkout proxy", () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    } as never)
    vi.mocked(getImpersonationContext).mockResolvedValue(null)
    vi.mocked(getAuthApiKeyAndTeamForUser).mockResolvedValue({
      apiKey: "server-owned-key",
      team: { teamId: "team-east", region: "use" },
    })
  })
  it("forwards only the bounded recovery fields with server auth", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ outcome: "payment_confirmation_pending" }),
        { status: 202 },
      ),
    )
    const path = ["billing", "prepaid", "checkout", "recover"]
    const response = await POST(
      req("POST", path, {
        body: JSON.stringify({
          expected_team: "use:team-east",
          purchase_id: "33333333-3333-4333-8333-333333333333",
          checkout_generation: "2026-10-26T12:00:00.123456789Z",
          cancel: true,
          amount_cents: 999999,
          customer: "untrusted",
          url: "https://external.test",
        }),
      }),
      params(path),
    )
    expect(response.status).toBe(202)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "https://api.test.superserve.ai/billing/prepaid/checkout/recover",
    )
    expect(JSON.parse(init.body)).toEqual({
      purchase_id: "33333333-3333-4333-8333-333333333333",
      checkout_generation: "2026-10-26T12:00:00.123456789Z",
      cancel: true,
    })
    expect(init.headers.get("X-API-Key")).toBeTruthy()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("does not permit discovery or cancellation during impersonation", async () => {
    vi.mocked(getImpersonationContext).mockResolvedValue({
      teamId: "team-west",
      region: "usw",
    } as never)
    const path = ["billing", "prepaid", "checkout", "recover"]
    const response = await POST(
      req("POST", path, {
        body: JSON.stringify({ expected_team: "usw:team-west" }),
      }),
      params(path),
    )
    expect(response.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it("preserves backend permission denial instead of treating it as no pending purchase", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "permission_denied" } }), {
        status: 403,
      }),
    )
    const path = ["billing", "prepaid", "checkout", "recover"]
    const response = await POST(
      req("POST", path, {
        body: JSON.stringify({ expected_team: "use:team-east" }),
      }),
      params(path),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: "permission_denied" },
    })
  })
})
