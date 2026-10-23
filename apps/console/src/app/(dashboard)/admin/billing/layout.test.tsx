import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  usePathname: () => "/admin/billing",
}))
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))

import { createServerClient } from "@/lib/supabase/server"

import AdminBillingLayout from "./layout"

function signIn(email: string, permissions: string[]) {
  vi.mocked(createServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "u1",
            email,
            app_metadata: {
              provider: "google",
              providers: ["google"],
              permissions,
            },
          },
        },
      }),
    },
  } as never)
}

beforeEach(() => vi.clearAllMocks())

describe("AdminBillingLayout", () => {
  it("renders for staff with billing read", async () => {
    signIn("ops@superserve.ai", ["platform:billing:read"])
    await expect(AdminBillingLayout({ children: null })).resolves.toBeTruthy()
  })

  it("hides the section from staff without billing read", async () => {
    signIn("ops@superserve.ai", ["platform:teams:read"])
    await expect(AdminBillingLayout({ children: null })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
  })

  it("hides the section from non-staff holding the permission", async () => {
    signIn("ops@example.com", ["platform:billing:read"])
    await expect(AdminBillingLayout({ children: null })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
  })
})
