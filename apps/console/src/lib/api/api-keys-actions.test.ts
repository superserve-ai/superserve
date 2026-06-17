import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationTeamId: async () => "team-1",
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "a1", email: "amit@superserve.ai" } },
      }),
    },
  }),
}))

import { createApiKeyAction } from "./api-keys-actions"

describe("createApiKeyAction while impersonating", () => {
  it("refuses to mint a key", async () => {
    await expect(createApiKeyAction("escape")).rejects.toThrow(/Read-only/)
  })
})
