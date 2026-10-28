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
  confirmSignupCheckout: (...args: unknown[]) => confirm(...args),
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

  it("waits on the picker when confirmation fails", async () => {
    confirm.mockRejectedValue(new Error("cell down"))
    expect((await visit()).searchParams.get("reason")).toBe(
      "payment_confirming",
    )
  })

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
