/**
 * API proxy tests — exercises the catch-all that forwards browser requests
 * to the sandbox API. Covers:
 *  - Allowed prefix list vs 404
 *  - X-API-Key injection for authenticated requests
 *  - SKIP_KEY_INJECTION (v1/auth/ — no key, client Authorization preserved)
 *  - Header allowlist: cookie, x-api-key from client are stripped
 *  - 204/205/304 null-body handling
 *  - 401 when not authenticated
 *  - /api/qm/* routing to the qm-api service (QM_API_URL, read per request)
 */

import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mocks declared BEFORE the module under test is imported.
vi.mock("@/lib/api/proxy-auth", () => ({
  getApiBaseUrlForUser: vi.fn(),
  getAuthApiKeyForUser: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: vi.fn(),
}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: (region: string) => ({
    region,
    apiBaseUrl: `https://api-${region}.test`,
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
import {
  getApiBaseUrlForUser,
  getAuthApiKeyForUser,
} from "@/lib/api/proxy-auth"
import { createServerClient } from "@/lib/supabase/server"

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
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    fetchSpy.mockReset()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    } as never)
    vi.mocked(getAuthApiKeyForUser).mockReset()
    vi.mocked(getAuthApiKeyForUser).mockResolvedValue("ss_live_test_key")
    vi.mocked(getApiBaseUrlForUser).mockReset()
    vi.mocked(getApiBaseUrlForUser).mockResolvedValue(
      "https://api.test.superserve.ai",
    )
    vi.mocked(getImpersonationContext).mockReset()
    vi.mocked(getImpersonationContext).mockResolvedValue(null)
  })

  it("returns 404 for a path outside the allowed prefixes", async () => {
    const res = await GET(req("GET", ["unknown"]), params(["unknown"]))
    expect(res.status).toBe(404)
  })

  it("forwards the billing usage-series endpoint", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))

    const request = new NextRequest(
      new URL(
        "https://console.test/api/billing/usage-series?start=2026-01-01T00%3A00%3A00.000Z&end=2026-01-02T00%3A00%3A00.000Z&granularity=hour&timezone=UTC",
      ),
      { method: "GET" },
    )
    const res = await GET(request, params(["billing", "usage-series"]))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.test.superserve.ai/billing/usage-series?start=2026-01-01T00%3A00%3A00.000Z&end=2026-01-02T00%3A00%3A00.000Z&granularity=hour&timezone=UTC",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("forwards the secrets, providers, activity, and billing prefixes", async () => {
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
    expect(fetchSpy).toHaveBeenCalledTimes(7)
    expect(fetchSpy.mock.calls[6][0]).toBe(
      "https://api.test.superserve.ai/teams/team-a/billing/periods/period-1/export-preview",
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
    expect(stripeRes.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(8)
    expect(fetchSpy.mock.calls[7][0]).toBe(
      "https://api.test.superserve.ai/stripe/checkout-session",
    )

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
    expect(fetchSpy).toHaveBeenCalledTimes(9)
    expect(fetchSpy.mock.calls[8][0]).toBe(
      "https://api.test.superserve.ai/stripe/customer-portal-session",
    )
  })

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(getAuthApiKeyForUser).mockResolvedValue(null)
    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("injects X-API-Key on authenticated requests to /sandboxes", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: "s1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))

    expect(res.status).toBe(200)
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
    )
    expect(getApiBaseUrlForUser).not.toHaveBeenCalled()
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
  describe("qm-api routing (/api/qm/*)", () => {
    const QM_PATH = ["qm", "tenants"]

    beforeEach(() => {
      vi.stubEnv("QM_API_URL", "https://qm-api.test/")
    })

    it("forwards /api/qm/* to ${QM_API_URL}/v1/qm/* with the query string preserved", async () => {
      fetchSpy.mockResolvedValue(
        new Response('{"tenants":[]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      const request = new NextRequest(
        new URL("https://console.test/api/qm/tenants?limit=10&cursor=abc"),
        { method: "GET" },
      )

      const res = await GET(request, params(QM_PATH))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ tenants: [] })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, fetchInit] = fetchSpy.mock.calls[0]
      // Trailing slash on QM_API_URL is stripped; sandbox cell host is not used.
      expect(url).toBe("https://qm-api.test/v1/qm/tenants?limit=10&cursor=abc")
      const headers = fetchInit.headers as Headers
      expect(headers.get("x-api-key")).toBe("ss_live_test_key")
    })

    it("rejects dot segments so a qm path cannot escape /v1/qm/", async () => {
      for (const path of [
        ["qm", "..", "sandboxes"],
        ["qm", "%2e%2e", "sandboxes"],
        ["qm", "tenants", ".", "x"],
        ["qm", "tenants%2F..%2Fadmin"],
      ]) {
        const res = await GET(req("GET", path), params(path))
        expect(res.status).toBe(400)
        expect((await res.json()).error.code).toBe("invalid_path")
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("re-encodes qm path segments before forwarding", async () => {
      fetchSpy.mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      const path = ["qm", "slugs", "acme%20co", "availability"]

      await GET(req("GET", path), params(path))

      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://qm-api.test/v1/qm/slugs/acme%20co/availability",
      )
    })

    it("maps nested qm paths and passes body + status through", async () => {
      fetchSpy.mockResolvedValue(
        new Response('{"tenant":{"id":"t1"}}', {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      )
      const path = ["qm", "tenants", "t1", "retry"]

      const res = await POST(
        req("POST", path, {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "x" }),
        }),
        params(path),
      )

      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ tenant: { id: "t1" } })
      const [url, fetchInit] = fetchSpy.mock.calls[0]
      expect(url).toBe("https://qm-api.test/v1/qm/tenants/t1/retry")
      expect(fetchInit.method).toBe("POST")
      expect((fetchInit.body as ArrayBuffer).byteLength).toBeGreaterThan(0)
    })

    it("applies the same forwarded-header allowlist as other routes", async () => {
      fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))

      await GET(
        req("GET", QM_PATH, {
          headers: {
            cookie: "sb-access-token=leaked",
            "x-api-key": "ss_live_attacker",
            authorization: "Bearer user-token",
            "x-forwarded-for": "1.2.3.4",
            "content-type": "application/json",
          },
        }),
        params(QM_PATH),
      )

      const [, fetchInit] = fetchSpy.mock.calls[0]
      const headers = fetchInit.headers as Headers
      expect(headers.get("cookie")).toBeNull()
      expect(headers.get("authorization")).toBeNull()
      expect(headers.get("x-forwarded-for")).toBeNull()
      expect(headers.get("x-api-key")).toBe("ss_live_test_key")
      expect(headers.get("content-type")).toBe("application/json")
    })

    it("overrides team_id while impersonating and routes to qm-api", async () => {
      vi.mocked(getImpersonationContext).mockResolvedValue({
        teamId: "impersonated-team",
        region: "usw",
        teamName: "Impersonated Team",
      })
      fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }))
      const request = new NextRequest(
        new URL("https://console.test/api/qm/tenants?team_id=admin-team"),
        { method: "GET" },
      )

      await GET(request, params(QM_PATH))

      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe(
        "https://qm-api.test/v1/qm/tenants?team_id=impersonated-team",
      )
    })

    it("blocks writes while impersonating", async () => {
      vi.mocked(getImpersonationContext).mockResolvedValue({
        teamId: "impersonated-team",
        region: "usw",
        teamName: "Impersonated Team",
      })

      const res = await POST(
        req("POST", QM_PATH, {
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        params(QM_PATH),
      )

      expect(res.status).toBe(403)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("returns 503 with the error envelope when QM_API_URL is unset", async () => {
      vi.stubEnv("QM_API_URL", undefined)

      const res = await GET(req("GET", QM_PATH), params(QM_PATH))

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toEqual({
        error: {
          code: "qm_api_unavailable",
          message: expect.any(String),
        },
      })
      // Never falls through to the sandbox API.
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("treats a blank QM_API_URL as unset", async () => {
      vi.stubEnv("QM_API_URL", "   ")

      const res = await GET(req("GET", QM_PATH), params(QM_PATH))

      expect(res.status).toBe(503)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("401 wins over 503 when the caller is not authenticated", async () => {
      vi.stubEnv("QM_API_URL", undefined)
      vi.mocked(getAuthApiKeyForUser).mockResolvedValue(null)

      const res = await GET(req("GET", QM_PATH), params(QM_PATH))

      expect(res.status).toBe(401)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("leaves non-qm paths on the sandbox API even when QM_API_URL is unset", async () => {
      vi.stubEnv("QM_API_URL", undefined)
      fetchSpy.mockResolvedValue(new Response("[]", { status: 200 }))

      const res = await GET(req("GET", ["sandboxes"]), params(["sandboxes"]))

      expect(res.status).toBe(200)
      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe("https://api.test.superserve.ai/sandboxes")
    })

    it("does not send non-qm paths to qm-api when it is configured", async () => {
      fetchSpy.mockResolvedValue(new Response("[]", { status: 200 }))

      await GET(req("GET", ["templates"]), params(["templates"]))

      const [url] = fetchSpy.mock.calls[0]
      expect(url).toBe("https://api.test.superserve.ai/templates")
    })
  })
})
