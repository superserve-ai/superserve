import { describe, expect, it, vi } from "vitest"

const user = vi.hoisted(() => ({ current: null as { id: string } | null }))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: user.current } }) },
  }),
}))
const lookup = vi.hoisted(() => vi.fn())
vi.mock("./observe", () => ({ verifiedAccountDevice: lookup }))
const record = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/promotion-device-evidence", () => ({
  recordExistingAccountDevice: record,
}))

import { recordAccountDevice } from "./account-device-action"

describe("recordAccountDevice", () => {
  it("never queries the provider without a session", async () => {
    user.current = null
    await expect(recordAccountDevice("event-1")).resolves.toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })

  it("records the session account's verified device", async () => {
    user.current = { id: "user-1" }
    lookup.mockResolvedValue("visitor-1")
    record.mockResolvedValue(true)
    await expect(recordAccountDevice("event-1")).resolves.toBe(true)
    expect(lookup).toHaveBeenCalledWith("event-1", "user-1")
    expect(record).toHaveBeenCalledWith("user-1", "visitor-1")
  })
})
