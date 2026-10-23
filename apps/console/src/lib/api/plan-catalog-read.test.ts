import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: () => ({ apiBaseUrl: "https://api.example.com" }),
}))

import { FALLBACK_PLAN_CATALOG } from "./plan-catalog"
import { readPlanCatalog } from "./plan-catalog-read"

const proMonthly = {
  key: "pro_monthly",
  family: "pro",
  name: "Pro",
  interval_months: 1,
  price_cents: 150_000,
  monthly_credit_cents: 120_000,
  limits: {
    max_sandboxes: 500,
    max_template_vcpu: 8,
    max_template_memory_mib: 16_384,
    max_template_disk_mib: null,
  },
}

describe("readPlanCatalog", () => {
  afterEach(() => vi.restoreAllMocks())

  it("overlays purchasable plans and keeps fallback copy for unlisted ones", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ plans: [proMonthly] }), { status: 200 }),
      )

    const catalog = await readPlanCatalog()

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.example.com/billing/plans/public",
    )
    expect(catalog.pro_monthly.price_cents).toBe(150_000)
    expect(catalog.pro_monthly.limits.max_template_disk_mib).toBeNull()
    expect(catalog.starter_monthly).toEqual(
      FALLBACK_PLAN_CATALOG.starter_monthly,
    )
  })

  it("falls back entirely when the billing API is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    )

    await expect(readPlanCatalog()).resolves.toEqual(FALLBACK_PLAN_CATALOG)
  })
})
