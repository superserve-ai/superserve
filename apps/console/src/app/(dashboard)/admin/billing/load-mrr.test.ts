import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/admin/billing-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/billing-api")>()),
  adminBillingRequest: vi.fn(),
}))

import {
  adminBillingRequest,
  AdminBillingRequestError,
} from "@/lib/admin/billing-api"

import { loadRegionMRR } from "./load-mrr"

beforeEach(() => {
  vi.mocked(adminBillingRequest).mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("loadRegionMRR", () => {
  it("keeps a refused request distinct from an unreachable region", async () => {
    vi.mocked(adminBillingRequest).mockRejectedValueOnce(
      new AdminBillingRequestError("forbidden"),
    )
    await expect(loadRegionMRR("use")).resolves.toEqual({
      region: "use",
      kind: "forbidden",
    })
    vi.mocked(adminBillingRequest).mockRejectedValueOnce(new Error("boom"))
    await expect(loadRegionMRR("usw")).resolves.toEqual({
      region: "usw",
      kind: "unavailable",
    })
    expect(console.error).toHaveBeenCalledTimes(2)
  })
})
