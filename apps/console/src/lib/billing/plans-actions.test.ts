import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getPricingVersionAction,
  getPublicBillingPlansAction,
} from "./plans-actions"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("SANDBOX_API_URL", "https://use.example.com")
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("getPricingVersionAction", () => {
  it("reads the region's live pricing model", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ pricing_version: "v2", cards: [] }), {
        status: 200,
      }),
    )
    await expect(getPricingVersionAction("use")).resolves.toBe("v2")
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://use.example.com/billing/plans/public",
    )
  })

  it("keeps today's flows when the switch cannot be read", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }))
    await expect(getPricingVersionAction("use")).resolves.toBe("legacy")
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ pricing_version: "v3", cards: [] }), {
        status: 200,
      }),
    )
    await expect(getPricingVersionAction("use")).resolves.toBe("legacy")
  })
  it("does not substitute another cell for an unavailable region", async () => {
    vi.stubEnv("SUPABASE_USWEST_URL", "")
    vi.stubEnv("SUPABASE_USWEST_SERVICE_ROLE_KEY", "")
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ pricing_version: "v2", cards: [] })),
    )
    await expect(getPublicBillingPlansAction("usw")).rejects.toThrow(
      "not configured",
    )
    await expect(getPricingVersionAction("usw")).resolves.toBe("legacy")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
