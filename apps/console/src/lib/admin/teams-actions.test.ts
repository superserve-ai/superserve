import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin/staff", () => ({
  requireImpersonationAccess: async () => {
    throw new Error("Forbidden: users:read access required")
  },
}))

import { listAllTeamsAction } from "./teams-actions"

describe("listAllTeamsAction", () => {
  it("requires users:read", async () => {
    await expect(listAllTeamsAction()).rejects.toThrow(/users:read/)
  })
})
