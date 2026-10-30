// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

let user: { id: string } | null
const confirm = vi.fn()
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
  }),
}))
vi.mock("@/lib/api/signup-checkout", () => ({
  settleSignupCheckout: (...args: unknown[]) => confirm(...args),
}))

import { GET } from "./route"

const visit = async () =>
  new URL(
    (
      await GET(
        new Request(
          "https://console.example.test/api/onboarding/checkout/return/?account=u1&team=use%3At1",
        ),
      )
    ).headers.get("location")!,
  )

describe("checkout return", () => {
  beforeEach(() => {
    user = { id: "u1" }
    confirm.mockReset()
  })

  it("sends a settled payment to the console", async () => {
    confirm.mockResolvedValue("/sandboxes")
    expect((await visit()).pathname).toBe("/sandboxes")
    expect(confirm).toHaveBeenCalledWith(user, "u1", "use:t1")
  })

  it.each([
    ["still settles", () => confirm.mockResolvedValue(null)],
    ["fails", () => confirm.mockRejectedValue(new Error("cell down"))],
  ])(
    "waits for the payment, never on the picker, when it %s",
    async (_, arrange) => {
      arrange()
      const location = await visit()
      expect(location.pathname).toBe("/onboarding/payment/")
      expect(location.search).toBe("?account=u1&team=use%3At1")
    },
  )

  it("asks for sign-in and comes back to confirm", async () => {
    user = null
    const location = await visit()
    expect(location.pathname).toBe("/auth/signin")
    expect(location.searchParams.get("next")).toBe(
      "/api/onboarding/checkout/return/?account=u1&team=use%3At1",
    )
    expect(confirm).not.toHaveBeenCalled()
  })
})
