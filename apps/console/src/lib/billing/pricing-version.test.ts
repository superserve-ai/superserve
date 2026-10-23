import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

import { isPricingV2Enabled } from "./pricing-version"

let fetchSpy: MockInstance<typeof fetch>

describe("isPricingV2Enabled", () => {
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch")
  })

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
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it("keeps legacy flows when the API is unreachable", async () => {
    fetchSpy.mockRejectedValue(new Error("offline"))
    await expect(isPricingV2Enabled()).resolves.toBe(false)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it("bounds how long signup waits for the switch", async () => {
    fetchSpy.mockResolvedValue(Response.json({ pricing_version: "v2" }))
    await isPricingV2Enabled()
    expect(fetchSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
