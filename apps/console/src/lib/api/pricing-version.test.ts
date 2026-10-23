import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./client", () => ({ apiClient: vi.fn() }))

import { apiClient } from "./client"
import { fetchPricingVersion, pricingVersionOf } from "./pricing-version"

describe("pricingVersionOf", () => {
  it("is v2 only when the catalog says so explicitly", () => {
    expect(pricingVersionOf({ pricing_version: "v2", plans: [] })).toBe("v2")
    for (const body of [
      { plans: [] },
      { pricing_version: "legacy" },
      { pricing_version: "V2" },
      { pricing_version: true },
      null,
      "v2",
      [],
    ]) {
      expect(pricingVersionOf(body)).toBe("legacy")
    }
  })
})

describe("fetchPricingVersion", () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset()
  })

  it("reads the public plan catalog", async () => {
    vi.mocked(apiClient).mockResolvedValue({ pricing_version: "v2" })
    await expect(fetchPricingVersion()).resolves.toBe("v2")
    expect(apiClient).toHaveBeenCalledWith("/billing/plans/public")
  })

  it("stays on legacy pricing when the catalog is unavailable", async () => {
    vi.mocked(apiClient).mockRejectedValue(new Error("down"))
    await expect(fetchPricingVersion()).resolves.toBe("legacy")
  })
})
