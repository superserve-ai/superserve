/**
 * Middleware tests — route protection, public bypass, cookie refresh
 * preservation on redirect.
 *
 * The middleware delegates session lookup to `createMiddlewareClient` from
 * `@/lib/supabase/middleware`, which we mock. We assert:
 *   1. Unauthenticated users on protected routes get a redirect to
 *      /auth/signin?next=<current path>, with cookies from
 *      client.response copied onto the redirect (regression guard for the
 *      "dropped refreshed cookies on redirect" bug).
 *   2. Unauthenticated users on public routes are allowed through.
 *   3. Authenticated users are allowed through.
 *   4. When the Supabase client is absent (missing env), the raw response
 *      is returned.
 */

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mock createMiddlewareClient ---

type MockClient = {
  supabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
  } | null
  response: NextResponse
}

let mockClient: MockClient

vi.mock("@/lib/supabase/middleware", () => ({
  createMiddlewareClient: () => mockClient,
  matchesRoute: (pathname: string, routes: string[]) =>
    routes.some((r) => pathname === r || pathname.startsWith(`${r}/`)),
}))

// Import AFTER mocks so the module picks them up.
import { config, middleware } from "./middleware"

function buildRequest(path: string): NextRequest {
  return new NextRequest(new URL(`https://console.superserve.ai${path}`))
}

function buildResponse(
  cookies: Array<{ name: string; value: string }> = [],
): NextResponse {
  const res = NextResponse.next()
  for (const { name, value } of cookies) {
    res.cookies.set(name, value)
  }
  return res
}

describe("middleware", () => {
  it("retains only an allowlisted YC locator through anonymous sign-in", async () => {
    mockClient = {
      supabase: {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      },
      response: buildResponse(),
    }
    const next = "/yc/accept?claim=11111111-1111-4111-8111-111111111111"
    const response = await middleware(buildRequest(next))
    expect(
      new URL(response.headers.get("location")!).searchParams.get("next"),
    ).toBe(next)
    const forged = await middleware(
      buildRequest("/yc/accept?state=funding_ready"),
    )
    expect(
      new URL(forged.headers.get("location")!).searchParams.get("next"),
    ).toBe("/yc/accept")
  })
  beforeEach(() => {
    vi.stubEnv("YC_STAFF_UI_ENABLED", "false")
    mockClient = {
      supabase: {
        auth: {
          getUser: vi
            .fn()
            .mockResolvedValue({ data: { user: null }, error: null }),
        },
      },
      response: buildResponse(),
    }
  })

  it("returns the raw response when supabase client is missing", async () => {
    mockClient.supabase = null
    const res = await middleware(buildRequest("/sandboxes"))
    // With no supabase, we should just pass client.response through.
    expect(res).toBe(mockClient.response)
  })

  it.each([
    [
      "true",
      "/admin/yc?claim=11111111-1111-4111-8111-111111111111",
      "/admin/yc?claim=11111111-1111-4111-8111-111111111111",
    ],
    [
      "true",
      "/admin/yc/?claim=11111111-1111-4111-8111-111111111111",
      "/admin/yc?claim=11111111-1111-4111-8111-111111111111",
    ],
    [
      "false",
      "/admin/yc?claim=11111111-1111-4111-8111-111111111111",
      "/admin/yc",
    ],
    ["true", "/admin/yc?claim=bad", "/admin/yc"],
    [
      "true",
      "/admin/yc?claim=11111111-1111-4111-8111-111111111111&next=//evil.example",
      "/admin/yc",
    ],
  ])(
    "validates the direct staff-entry locator with flag %s: %s",
    async (enabled, path, expected) => {
      vi.stubEnv("YC_STAFF_UI_ENABLED", enabled)
      mockClient!.supabase!.auth.getUser.mockResolvedValue({
        data: { user: null },
      })
      mockClient.response = buildResponse([
        { name: "refreshed-auth", value: "synthetic" },
      ])
      const response = await middleware(buildRequest(path))
      const destination = new URL(response.headers.get("location")!)
      expect(destination.pathname.replace(/\/$/, "")).toBe("/auth/signin")
      expect(destination.searchParams.get("next")).toBe(expected)
      expect(response.cookies.get("refreshed-auth")?.value).toBe("synthetic")
    },
  )

  it("redirects unauthenticated users on protected routes with next param", async () => {
    const res = await middleware(buildRequest("/sandboxes/abc"))

    // Should be a redirect
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)

    const location = res.headers.get("location")
    expect(location).toContain("/auth/signin")
    expect(location).toContain("next=%2Fsandboxes%2Fabc")
  })

  it("preserves the full checkout return through sign-in", async () => {
    const path =
      "/onboarding/plan/?team=use%3Aoriginal&account=user&billing=success"
    const response = await middleware(buildRequest(path))
    expect(
      new URL(response.headers.get("location")!).searchParams.get("next"),
    ).toBe(path)
  })

  it("retains Pro payment recovery locators through anonymous sign-in", async () => {
    const path =
      "/billing/pro/?billing=success&team=use%3Aoriginal&return=%2Fsandboxes"
    const response = await middleware(buildRequest(path))
    expect(
      new URL(response.headers.get("location")!).searchParams.get("next"),
    ).toBe(path)
    const forged = await middleware(buildRequest("/billing/pro/?approved=true"))
    expect(
      new URL(forged.headers.get("location")!).searchParams.get("next"),
    ).toBe("/billing/pro/")
  })

  it("preserves refreshed auth cookies from client.response on redirect", async () => {
    // Simulate Supabase writing refreshed auth cookies onto client.response
    // (which is what setAll does when getUser() refreshes the token).
    mockClient.response = buildResponse([
      { name: "sb-access-token", value: "refreshed-token" },
      { name: "sb-refresh-token", value: "refreshed-refresh" },
    ])

    const res = await middleware(buildRequest("/sandboxes"))

    // The redirect must carry those cookies forward.
    const accessCookie = res.cookies.get("sb-access-token")
    const refreshCookie = res.cookies.get("sb-refresh-token")
    expect(accessCookie?.value).toBe("refreshed-token")
    expect(refreshCookie?.value).toBe("refreshed-refresh")
  })

  it("lets unauthenticated users through on public routes", async () => {
    for (const path of [
      "/auth/signin",
      "/auth/signup",
      "/auth/forgot-password",
      "/auth/callback",
      "/device",
    ]) {
      const res = await middleware(buildRequest(path))
      // Not a redirect — we should get the raw client.response back.
      expect(res).toBe(mockClient.response)
    }
  })

  it("lets authenticated users through on protected routes", async () => {
    mockClient.supabase!.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "u@e.com" } },
      error: null,
    })

    const res = await middleware(buildRequest("/sandboxes"))
    expect(res).toBe(mockClient.response)
  })

  it.each([
    { signup_review: "pending" },
    { signup_enterprise_pricing_pending: true },
  ])(
    "blocks Enterprise setup or unresolved pricing even without URL intent (%o)",
    async (metadata) => {
      const signOut = vi.fn().mockResolvedValue({ error: null })
      Object.assign(mockClient.supabase!.auth, { signOut })
      mockClient.supabase!.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: "user-123",
            email: "u@e.com",
            app_metadata: metadata,
          },
        },
        error: null,
      })

      const res = await middleware(buildRequest("/sandboxes"))
      expect(signOut).toHaveBeenCalled()
      expect(new URL(res.headers.get("location")!).pathname).toBe(
        "/auth/pending",
      )
      expect(await middleware(buildRequest("/auth/pending"))).toBe(
        mockClient.response,
      )
    },
  )

  it.each([
    {},
    { signup_review: "approved" },
    { signup_review: "approved", signup_enterprise_pricing_pending: true },
  ])("lets an account without a hold through (%o)", async (metadata) => {
    const signOut = vi.fn()
    Object.assign(mockClient.supabase!.auth, { signOut })
    mockClient.supabase!.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-123", app_metadata: metadata } },
      error: null,
    })
    expect(await middleware(buildRequest("/sandboxes"))).toBe(
      mockClient.response,
    )
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe("middleware matcher", () => {
  it.each([
    "/ingest",
    "/ingest/",
    "/ingest/i/v0/e/?ip=0",
    "/ingest/s/",
    "/ingest/static/array.js",
  ])("bypasses auth for analytics request %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false)
  })

  it.each(["/", "/sandboxes", "/settings", "/ingestion", "/ingest-private"])(
    "still protects %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true)
    },
  )
})

it.each(["/billing/pro/", "/plan-usage/buy-credit/"])(
  "fails closed for invalid generic return at %s",
  async (path) => {
    for (const marker of [
      "unknown",
      "success&billing_flow=cancel",
      "success&approved=true",
    ]) {
      mockClient = {
        supabase: {
          auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
          },
        },
        response: buildResponse(),
      }
      const response = await middleware(
        buildRequest(`${path}?team=original&billing_flow=${marker}`),
      )
      expect(
        new URL(response.headers.get("location")!).searchParams.get("next"),
      ).toBe("/auth/auth-code-error/")
      const errorPage = await middleware(buildRequest("/auth/auth-code-error/"))
      expect(errorPage).toBe(mockClient.response)
      expect(errorPage.headers.get("location")).toBeNull()
      const signin = await middleware(
        buildRequest("/auth/signin/?next=%2Fauth%2Fauth-code-error%2F"),
      )
      expect(signin).toBe(mockClient.response)
    }
  },
)
