import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationTeamId: vi.fn(),
}))

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import { createServerClient } from "@/lib/supabase/server"

import type { PlanVersion } from "./billing-catalog"
import {
  createDraftAction,
  updateDraftAction,
  previewScheduleAction,
  publishVersionAction,
  retireVersionAction,
  setPricingVersionAction,
  syncVersionAction,
} from "./billing-catalog-actions"

const VERSION = "11111111-1111-4111-8111-111111111111"
const fetchMock = vi.fn()

function signIn(permissions: string[]) {
  vi.mocked(createServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "staff-1",
            email: "ops@superserve.ai",
            app_metadata: {
              provider: "google",
              providers: ["google"],
              permissions,
            },
          },
        },
      }),
    },
  } as never)
}

function plan(overrides: Partial<PlanVersion> = {}): PlanVersion {
  return {
    id: VERSION,
    pricing_version: "legacy",
    family: "pro",
    version: 2,
    state: "draft",
    kind: "subscription",
    public: true,
    display_name: "Pro",
    price_label: "",
    tagline: "",
    features: [],
    sort_order: 2,
    display_only: false,
    self_serve: true,
    monthly_fee_cents: 150000,
    annual_fee_cents: null,
    credit_schedule: [],
    matching: null,
    allowance: null,
    limits: {
      max_concurrent: 1000,
      max_vcpu: null,
      max_memory_mib: null,
      max_disk_mib: null,
      max_templates: null,
    },
    created_at: "2026-10-01T00:00:00Z",
    published_at: null,
    retired_at: null,
    preview: { issues: [], summary: "No included credit", months: 24 },
    ...overrides,
  }
}

// catalogs maps region host to the plans its GET /internal/billing/catalog returns.
function serve(
  catalogs: Record<string, unknown[]>,
  fail: Record<string, number> = {},
) {
  fetchMock.mockImplementation(async (url: URL, init: RequestInit) => {
    const host = new URL(url).host
    if (init.method === "GET" && url.pathname === "/internal/billing/catalog")
      return new Response(
        JSON.stringify({
          plans: catalogs[host] ?? [],
          pricing_version: "legacy",
        }),
        { status: 200 },
      )
    if (fail[host]) return new Response("{}", { status: fail[host] })
    return new Response("{}", { status: 200 })
  })
}

function draftOf(p: ReturnType<typeof plan>) {
  const {
    id: _id,
    version: _v,
    state: _s,
    created_at: _c,
    published_at: _p,
    retired_at: _r,
    preview: _preview,
    ...draft
  } = p
  return draft
}

function writes() {
  return fetchMock.mock.calls
    .filter(([, init]) => init.method !== "GET")
    .map(([url, init]) => ({
      host: new URL(url).host,
      path: new URL(url).pathname,
      method: init.method,
      token: init.headers.Authorization,
      body: init.body ? JSON.parse(init.body) : undefined,
    }))
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("SANDBOX_API_URL", "https://use.example.com")
  vi.stubEnv("SANDBOX_API_URL_USWEST", "https://usw.example.com")
  vi.stubEnv("SUPABASE_USWEST_URL", "https://usw-db.example.com")
  vi.stubEnv("SUPABASE_USWEST_SERVICE_ROLE_KEY", "service-role-usw")
  vi.stubEnv("INTERNAL_API_TOKEN", "internal-use")
  vi.stubEnv("INTERNAL_API_TOKEN_USWEST", "internal-usw")
  vi.stubEnv("OPERATOR_API_TOKEN", "operator-use")
  vi.stubEnv("OPERATOR_API_TOKEN_USWEST", "operator-usw")
  vi.mocked(getImpersonationTeamId).mockResolvedValue(null as never)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("billing catalog fan-out", () => {
  it("creates one version id and number in every region", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve({
      "use.example.com": [plan({ version: 3, state: "published" })],
      "usw.example.com": [plan({ version: 4, id: "other", state: "draft" })],
    })
    const result = await createDraftAction(
      { ...draftOf(plan()), monthly_fee_cents: 160000 },
      "Raise the Pro fee",
    )
    expect(result.errors).toEqual({})
    const creates = writes()
    expect(creates.map((w) => [w.host, w.token])).toEqual([
      ["use.example.com", "Bearer operator-use"],
      ["usw.example.com", "Bearer operator-usw"],
    ])
    expect(new Set(creates.map((w) => w.body.id)).size).toBe(1)
    expect(creates.every((w) => w.body.id === result.id)).toBe(true)
    expect(creates.every((w) => w.body.version === 5)).toBe(true)
    expect(creates[0]!.body.reason).toBe("Raise the Pro fee")
  })

  it("reports the regions that failed so the change can be retried", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve(
      { "use.example.com": [plan()], "usw.example.com": [plan()] },
      { "usw.example.com": 500 },
    )
    const result = await publishVersionAction(VERSION, "Launch")
    expect(Object.keys(result.errors)).toEqual(["usw"])
    expect(
      writes().every(
        (write) =>
          JSON.stringify(write.body.expected) ===
          JSON.stringify(draftOf(plan())),
      ),
    ).toBe(true)
    expect(writes().map((w) => w.path)).toEqual([
      `/internal/billing/catalog/plans/${VERSION}/publish`,
      `/internal/billing/catalog/plans/${VERSION}/publish`,
    ])
  })

  it("refuses to publish a draft that is missing or differs in a region", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve({ "use.example.com": [plan()], "usw.example.com": [] })
    expect(
      (await publishVersionAction(VERSION, "Launch")).errors,
    ).toHaveProperty("all")
    serve({
      "use.example.com": [plan()],
      "usw.example.com": [plan({ monthly_fee_cents: 1 })],
    })
    expect(
      (await publishVersionAction(VERSION, "Launch")).errors,
    ).toHaveProperty("all")
    serve({
      "use.example.com": [plan({ state: "retired" })],
      "usw.example.com": [plan()],
    })
    expect(
      (await publishVersionAction(VERSION, "Launch")).errors,
    ).toHaveProperty("all")
    expect(writes()).toEqual([])
  })

  it("syncs a version published in one region into the region missing it", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve({
      "use.example.com": [plan({ state: "published" })],
      "usw.example.com": [],
    })
    const result = await syncVersionAction(VERSION, "Finish rollout")
    expect(result.errors).toEqual({})
    const steps = writes()
    expect(steps.map((w) => [w.host, w.path])).toEqual([
      ["usw.example.com", "/internal/billing/catalog/plans"],
      ["usw.example.com", `/internal/billing/catalog/plans/${VERSION}/publish`],
    ])
    expect(steps[0]!.body).toMatchObject({
      id: VERSION,
      version: 2,
      monthly_fee_cents: 150000,
    })
  })

  it("removes the drafts it made when a region rejects the create", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve(
      { "use.example.com": [], "usw.example.com": [] },
      { "usw.example.com": 409 },
    )
    const result = await createDraftAction(
      { ...draftOf(plan()), monthly_fee_cents: 160000 },
      "Raise the Pro fee",
    )
    expect(result.id).toBeUndefined()
    expect(Object.keys(result.errors)).toEqual(["usw"])
    const created = writes().find((w) => w.method === "POST")!.body.id
    expect(
      writes()
        .filter((w) => w.method === "DELETE")
        .map((w) => [w.host, w.path]),
    ).toEqual([
      ["use.example.com", `/internal/billing/catalog/plans/${created}`],
    ])
  })

  it("refuses to edit a version that was published in any region", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve({
      "use.example.com": [plan({ state: "published" })],
      "usw.example.com": [plan()],
    })
    const result = await updateDraftAction(VERSION, draftOf(plan()), "Edit")
    expect(result.errors).toHaveProperty("all")
    expect(writes()).toEqual([])
  })

  it("does not sync a region whose draft holds different terms", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve({
      "use.example.com": [plan({ state: "published" })],
      "usw.example.com": [plan({ monthly_fee_cents: 1 })],
    })
    const result = await syncVersionAction(VERSION, "Finish rollout")
    expect(Object.keys(result.errors)).toEqual(["usw"])
    expect(
      writes().every(
        (write) =>
          JSON.stringify(write.body.expected) ===
          JSON.stringify(draftOf(plan())),
      ),
    ).toBe(true)
    expect(writes()).toEqual([])
  })

  it("refuses writes without platform billing write", async () => {
    signIn(["platform:billing:read"])
    serve({ "use.example.com": [], "usw.example.com": [] })
    const result = await setPricingVersionAction("v2", "Launch v2")
    expect(Object.keys(result.errors)).toEqual(["use", "usw"])
    expect(writes()).toEqual([])
  })

  it("switches the pricing model in every region with the reason", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    const v2 = plan({ pricing_version: "v2", state: "published" })
    serve({ "use.example.com": [v2], "usw.example.com": [v2] })
    const result = await setPricingVersionAction("v2", "Launch v2")
    expect(result.errors).toEqual({})
    expect(writes().map((w) => [w.host, w.path, w.token, w.body])).toEqual(
      ["use", "usw"].map((region) => [
        `${region}.example.com`,
        "/internal/billing/pricing-version",
        `Bearer operator-${region}`,
        { pricing_version: "v2", reason: "Launch v2" },
      ]),
    )
  })

  it("switches back to legacy even while v2 plans differ between regions", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve({
      "use.example.com": [plan({ pricing_version: "v2", state: "published" })],
      "usw.example.com": [],
    })
    const result = await setPricingVersionAction("legacy", "Roll back")
    expect(result.errors).toEqual({})
    expect(writes().map((w) => w.host)).toEqual([
      "use.example.com",
      "usw.example.com",
    ])
  })

  it("refuses to retire a version that is still a draft in a region", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve({
      "use.example.com": [plan({ state: "published" })],
      "usw.example.com": [plan()],
    })
    const result = await retireVersionAction(VERSION, "Withdraw")
    expect(result.errors).toHaveProperty("all")
    expect(writes()).toEqual([])
  })

  it("switches only the region staff chose", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    const v2 = plan({ pricing_version: "v2", state: "published" })
    serve({ "use.example.com": [v2], "usw.example.com": [v2] })
    const result = await setPricingVersionAction("v2", "Launch west", ["usw"])
    expect(result.errors).toEqual({})
    expect(writes().map((w) => w.host)).toEqual(["usw.example.com"])
  })

  it("refuses to switch to v2 while regions publish different v2 plans", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    serve({
      "use.example.com": [plan({ pricing_version: "v2", state: "published" })],
      "usw.example.com": [],
    })
    const result = await setPricingVersionAction("v2", "Launch v2")
    expect(result.errors).toHaveProperty("all")
    expect(writes()).toEqual([])
  })

  it("previews schedules with a read on the internal credential", async () => {
    signIn(["platform:billing:read"])
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          issues: [],
          summary: "No included credit",
          months: 24,
        }),
        { status: 200 },
      ),
    )
    await expect(previewScheduleAction("use", [])).resolves.toMatchObject({
      ok: true,
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(
      "https://use.example.com/internal/billing/catalog/preview?credit_schedule=%5B%5D",
    )
    expect(init.method).toBe("GET")
    expect(init.headers).toMatchObject({
      Authorization: "Bearer internal-use",
    })
  })

  it("shows staff the backend's validation message for rejected terms", async () => {
    signIn(["platform:billing:read", "platform:billing:write"])
    fetchMock.mockImplementation(async (_url: URL, init: RequestInit) => {
      if (init.method === "GET")
        return new Response(
          JSON.stringify({ plans: [plan()], pricing_version: "legacy" }),
          { status: 200 },
        )
      return new Response(
        JSON.stringify({
          error: { message: "credit grant 2: every and expiry 1-12 months" },
        }),
        { status: 400 },
      )
    })
    const result = await publishVersionAction(VERSION, "Launch")
    expect(result.errors.use).toBe(
      "credit grant 2: every and expiry 1-12 months",
    )
  })
})
