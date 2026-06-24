import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin/staff", () => ({
  requireStaff: async () => {
    throw new Error("Forbidden: staff access required")
  },
}))

import { listAllTeamsAction } from "./teams-actions"

describe("listAllTeamsAction", () => {
  it("requires staff", async () => {
    await expect(listAllTeamsAction()).rejects.toThrow(/staff/)
  })
})
