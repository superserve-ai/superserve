import { afterEach, describe, expect, it, vi } from "vitest"

import { isPricingV2Enabled } from "./pricing-version"

const fetchSpy = vi.spyOn(globalThis, "fetch")

describe("isPricingV2Enabled", () => {
  afterEach(() => fetchSpy.mockReset())

  it("is on only when the billing API says v2", async () => {
    fetchSpy.mockResolvedValue(Response.json({ pricing_version: "v2" }))
    await expect(isPricingV2Enabled()).resolves.toBe(true)
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(
      /\/billing\/plans\/public$/,
    )
  })

  it.each([
    ["legacy", () => Response.json({ pricing_version: "legacy" })],
    ["a response without the field", () => Response.json({ plans: [] })],
    ["an error status", () => new Response("", { status: 503 })],
  ])("keeps legacy flows for %s", async (_label, response) => {
    fetchSpy.mockResolvedValue(response())
    await expect(isPricingV2Enabled()).resolves.toBe(false)
  })

  it("keeps legacy flows when the API is unreachable", async () => {
    fetchSpy.mockRejectedValue(new Error("offline"))
    await expect(isPricingV2Enabled()).resolves.toBe(false)
  })
})
