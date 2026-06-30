import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin/staff", () => ({
  requireImpersonationAccess: async () => {
    throw new Error("Forbidden: platform:teams:read access required")
  },
}))

import { listAllTeamsAction } from "./teams-actions"

describe("listAllTeamsAction", () => {
  it("requires platform:teams:read", async () => {
    await expect(listAllTeamsAction()).rejects.toThrow(/platform:teams:read/)
  })
})
