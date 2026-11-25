import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  settle: vi.fn(async () => null),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}))
vi.mock("@/lib/api/signup-checkout", () => ({
  settleSignupCheckout: m.settle,
}))

import { checkSignupPaymentAction } from "./actions"

beforeEach(() => m.settle.mockClear())

it("records a completion only for a page reached from a counted return", async () => {
  await checkSignupPaymentAction("u1", "use:team-1")
  await checkSignupPaymentAction("u1", "use:team-1", true)
  // A value other than true from the client counts as no return.
  await checkSignupPaymentAction("u1", "use:team-1", "1" as unknown as boolean)
  expect(m.settle.mock.calls.map((call) => (call as unknown[])[3])).toEqual([
    false,
    true,
    false,
  ])
})
