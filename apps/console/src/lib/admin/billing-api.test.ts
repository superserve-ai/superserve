import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))

import { createServerClient } from "@/lib/supabase/server"

import { adminBillingRequest, AdminBillingRequestError } from "./billing-api"

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
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv("SANDBOX_API_URL", "https://api.example.com")
  vi.stubEnv("INTERNAL_API_TOKEN", "internal-token")
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
      adminBillingRequest({ region: "use", path: "/internal/x", schema }),
    ).resolves.toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.example.com/internal/x")
    expect(init.headers).toMatchObject({
      Authorization: "Bearer internal-token",
      "X-Actor-User-Id": "11111111-1111-4111-8111-111111111111",
    })
  })

  it("rejects users without staff billing access before calling the API", async () => {
    signIn({ ...staff(["platform:billing:read"]), email: "a@example.com" })
    expect(
      await kind(
        adminBillingRequest({ region: "use", path: "/internal/x", schema }),
      ),
    ).toBe("forbidden")
    signIn(staff([]))
    expect(
      await kind(
        adminBillingRequest({ region: "use", path: "/internal/x", schema }),
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
          path: "/internal/x",
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
        adminBillingRequest({ region: "eu", path: "/internal/x", schema }),
      ),
    ).toBe("unavailable")
    fetchMock.mockResolvedValue(Response.json({ ok: "yes" }))
    expect(
      await kind(
        adminBillingRequest({ region: "use", path: "/internal/x", schema }),
      ),
    ).toBe("unavailable")
  })

  it("maps backend statuses", async () => {
    signIn(staff(["platform:billing:read"]))
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    expect(
      await kind(
        adminBillingRequest({ region: "use", path: "/internal/x", schema }),
      ),
    ).toBe("forbidden")
    fetchMock.mockResolvedValue(new Response(null, { status: 409 }))
    expect(
      await kind(
        adminBillingRequest({ region: "use", path: "/internal/x", schema }),
      ),
    ).toBe("conflict")
  })
})
