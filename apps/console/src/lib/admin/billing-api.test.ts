import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationTeamId: vi.fn(async () => null),
}))

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import { createServerClient } from "@/lib/supabase/server"

import {
  adminBillingRequest,
  AdminBillingRequestError,
  isAdminBillingPath,
} from "./billing-api"

const staff = (permissions: string[]) => ({
  id: "11111111-1111-4111-8111-111111111111",
  email: "ops@superserve.ai",
  app_metadata: { provider: "google", providers: ["google"], permissions },
})

function signIn(user: unknown) {
  vi.mocked(createServerClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  } as never)
}

const schema = z.object({ ok: z.boolean() })
const TEAM = "11111111-1111-4111-8111-111111111111"
const WRITE_PATH = `/internal/teams/${TEAM}/billing/matching` as const
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv("SANDBOX_API_URL", "https://api.example.com")
  vi.stubEnv("INTERNAL_API_TOKEN", "internal-token")
  vi.stubEnv("OPERATOR_API_TOKEN", "operator-token")
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function kind(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(AdminBillingRequestError)
  return (error as AdminBillingRequestError).kind
}

describe("adminBillingRequest", () => {
  it("sends the internal token and staff actor for reads", async () => {
    signIn(staff(["platform:billing:read"]))
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    await expect(
      adminBillingRequest({
        region: "use",
        path: "/internal/billing/x",
        schema,
      }),
    ).resolves.toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.example.com/internal/billing/x")
    expect(init.headers).toMatchObject({
      Authorization: "Bearer internal-token",
      "X-Actor-User-Id": "11111111-1111-4111-8111-111111111111",
    })
  })

  it("rejects users without staff billing access before calling the API", async () => {
    signIn({ ...staff(["platform:billing:read"]), email: "a@example.com" })
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: "/internal/billing/x",
          schema,
        }),
      ),
    ).toBe("forbidden")
    signIn(staff([]))
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: "/internal/billing/x",
          schema,
        }),
      ),
    ).toBe("forbidden")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("requires billing write for mutations", async () => {
    signIn(staff(["platform:billing:read"]))
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: WRITE_PATH,
          schema,
          method: "POST",
          body: {},
        }),
      ),
    ).toBe("forbidden")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("treats unknown regions and malformed responses as unavailable", async () => {
    signIn(staff(["platform:billing:read"]))
    expect(
      await kind(
        adminBillingRequest({
          region: "eu",
          path: "/internal/billing/x",
          schema,
        }),
      ),
    ).toBe("unavailable")
    fetchMock.mockResolvedValue(Response.json({ ok: "yes" }))
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: "/internal/billing/x",
          schema,
        }),
      ),
    ).toBe("unavailable")
  })

  it("maps backend statuses", async () => {
    signIn(staff(["platform:billing:read"]))
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: "/internal/billing/x",
          schema,
        }),
      ),
    ).toBe("forbidden")
    fetchMock.mockResolvedValue(new Response(null, { status: 409 }))
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: "/internal/billing/x",
          schema,
        }),
      ),
    ).toBe("conflict")
  })
})

describe("isAdminBillingPath", () => {
  const team = "11111111-1111-4111-8111-111111111111"

  it("accepts platform and team billing routes", () => {
    expect(isAdminBillingPath("/internal/billing")).toBe(true)
    expect(isAdminBillingPath("/internal/billing/mrr")).toBe(true)
    expect(isAdminBillingPath(`/internal/teams/${team}/billing/usage`)).toBe(
      true,
    )
  })

  it("rejects other internal routes and traversal", () => {
    for (const path of [
      "/internal/jwks",
      "/internal/secrets/decrypt",
      "/internal/billing/../jwks",
      "/internal/billing/%2e%2e/jwks",
      "/internal/billing\\..\\secrets",
      "/internal/billing?x=1",
      "/internal/billing#x",
      "/internal/teams/not-a-uuid/billing",
      `/internal/teams/${team}/members`,
    ]) {
      expect(isAdminBillingPath(path), path).toBe(false)
    }
  })

  it("refuses a non-billing path before calling the API", async () => {
    signIn(staff(["platform:billing:read"]))
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: "/internal/billing/../jwks",
          schema,
        }),
      ),
    ).toBe("invalid")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("adminBillingRequest configuration", () => {
  it("does not call an unconfigured cell even when its token is set", async () => {
    signIn(staff(["platform:billing:read"]))
    vi.stubEnv("INTERNAL_API_TOKEN_USWEST", "west-token")
    vi.stubEnv("SUPABASE_USWEST_URL", "")
    expect(
      await kind(
        adminBillingRequest({
          region: "usw",
          path: "/internal/billing/x",
          schema,
        }),
      ),
    ).toBe("unavailable")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reports a rejected internal token as unavailable", async () => {
    signIn(staff(["platform:billing:read"]))
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: "/internal/billing/x",
          schema,
        }),
      ),
    ).toBe("unavailable")
  })

  it("sends query parameters separately from the path", async () => {
    signIn(staff(["platform:billing:read"]))
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    await adminBillingRequest({
      region: "use",
      path: "/internal/billing/x",
      query: new URLSearchParams({ q: "a/../b" }),
      schema,
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.example.com/internal/billing/x?q=a%2F..%2Fb",
    )
  })
})

describe("adminBillingRequest credentials", () => {
  const writer = () =>
    signIn(staff(["platform:billing:read", "platform:billing:write"]))

  it("sends writes with the operator token, never the internal token", async () => {
    writer()
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    await adminBillingRequest({
      region: "use",
      path: WRITE_PATH,
      schema,
      method: "POST",
      body: { reason: "r" },
    })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe("Bearer operator-token")
    expect(init.body).toBe('{"reason":"r"}')
  })

  it("refuses writes while impersonating another team", async () => {
    writer()
    vi.mocked(getImpersonationTeamId).mockResolvedValueOnce(TEAM)
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: WRITE_PATH,
          schema,
          method: "POST",
          body: {},
        }),
      ),
    ).toBe("forbidden")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails closed when the operator token is missing", async () => {
    writer()
    vi.stubEnv("OPERATOR_API_TOKEN", "")
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: WRITE_PATH,
          schema,
          method: "POST",
          body: {},
        }),
      ),
    ).toBe("unavailable")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses writes when the operator token equals the internal token", async () => {
    writer()
    vi.stubEnv("OPERATOR_API_TOKEN", "internal-token")
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: WRITE_PATH,
          schema,
          method: "POST",
          body: {},
        }),
      ),
    ).toBe("unavailable")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses the region's own operator token", async () => {
    writer()
    vi.stubEnv("SUPABASE_USWEST_URL", "https://usw.example.com")
    vi.stubEnv("SUPABASE_USWEST_SERVICE_ROLE_KEY", "service-role")
    vi.stubEnv("SANDBOX_API_URL_USWEST", "https://api-usw.example.com")
    vi.stubEnv("OPERATOR_API_TOKEN_USWEST", "west-operator")
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    await adminBillingRequest({
      region: "usw",
      path: WRITE_PATH,
      schema,
      method: "POST",
      body: {},
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`https://api-usw.example.com${WRITE_PATH}`)
    expect(init.headers.Authorization).toBe("Bearer west-operator")
  })
})

describe("admin billing write routes", () => {
  it("only allows writes to listed routes", () => {
    for (const path of [
      `/internal/teams/${TEAM}/billing/matching`,
      `/internal/teams/${TEAM}/billing/matching/revoke`,
      `/internal/teams/${TEAM}/billing/matching/credits/${TEAM}/acknowledge`,
    ]) {
      expect(isAdminBillingPath(path, "POST"), path).toBe(true)
    }
    for (const path of [
      `/internal/teams/${TEAM}/billing/sponsored-entitlements`,
      `/internal/teams/${TEAM}/billing/sponsored-annual`,
      `/internal/teams/${TEAM}/billing/yc/approve`,
      `/internal/teams/${TEAM}/billing/anchor`,
      "/internal/billing/cutover",
      `/internal/teams/${TEAM}/billing/matching/extra`,
      `/internal/teams/${TEAM}/billing/matching/credits/not-a-uuid/acknowledge`,
    ]) {
      expect(isAdminBillingPath(path, "POST"), path).toBe(false)
      expect(isAdminBillingPath(path, "GET"), path).toBe(true)
    }
  })

  it("only allows the method each route is listed with", () => {
    expect(
      isAdminBillingPath(`/internal/teams/${TEAM}/billing/matching`, "DELETE"),
    ).toBe(false)
  })

  it("refuses an unlisted write before calling the API", async () => {
    signIn(staff(["platform:billing:read", "platform:billing:write"]))
    expect(
      await kind(
        adminBillingRequest({
          region: "use",
          path: `/internal/teams/${TEAM}/billing/yc/approve`,
          schema,
          method: "POST",
          body: {},
        }),
      ),
    ).toBe("invalid")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
