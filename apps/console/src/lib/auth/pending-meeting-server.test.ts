import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  getUser: vi.fn(),
  getUserById: vi.fn(),
  lookup: vi.fn(),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "signed-context" }) }),
}))
vi.mock("./pending-meeting-context", () => ({
  PENDING_MEETING_COOKIE: "ss-enterprise-meeting",
  verifyPendingMeetingContext: mocks.context,
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: mocks.getUserById } },
  }),
}))
vi.mock("./enterprise-meeting", () => ({
  lookupEnterpriseMeeting: mocks.lookup,
}))
import { readPendingMeeting } from "./pending-meeting-server"
const user = {
  id: "account",
  email: "verified@example.com",
  email_confirmed_at: "2026-10-25",
  app_metadata: { signup_review: "pending" },
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue(user.id)
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
  mocks.getUserById.mockResolvedValue({ data: { user }, error: null })
  mocks.lookup.mockResolvedValue({ state: "not_booked" })
})
it("resolves provider identity only from fresh admin account data after sign-out", async () => {
  expect(await readPendingMeeting()).toEqual({
    state: "not_booked",
    accountEmail: user.email,
  })
  expect(mocks.getUserById).toHaveBeenCalledWith(user.id)
  expect(mocks.lookup).toHaveBeenCalledWith(user.email)
})
it("refuses tampered/expired context and another current account before lookup", async () => {
  mocks.context.mockResolvedValueOnce(null)
  expect((await readPendingMeeting()).state).toBe("signin_required")
  mocks.getUser.mockResolvedValueOnce({
    data: { user: { id: "another-account" } },
    error: null,
  })
  expect((await readPendingMeeting()).state).toBe("signin_required")
  expect(mocks.lookup).not.toHaveBeenCalled()
})
it.each([
  { ...user, app_metadata: { signup_review: "approved" } },
  { ...user, email_confirmed_at: null },
  null,
])("refuses an approved, unconfirmed or missing account", async (account) => {
  mocks.getUserById.mockResolvedValueOnce({
    data: { user: account },
    error: null,
  })
  expect((await readPendingMeeting()).state).toBe("signin_required")
  expect(mocks.lookup).not.toHaveBeenCalled()
})
