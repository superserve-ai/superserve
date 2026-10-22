import { render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import StaffYCPage from "./page"
import { staffGoogleLogin, staffSignOut } from "./staff-login"
import { staffLoginSession, staffReviewPath } from "./staff-login-session"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  oauth: vi.fn(),
  signOut: vi.fn(),
  impersonation: vi.fn(),
  proof: vi.fn(),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
  readClaim: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      signInWithOAuth: mocks.oauth,
      signOut: mocks.signOut,
    },
  }),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: mocks.impersonation,
}))
vi.mock("@/lib/yc/signed-proof", () => ({ signProof: mocks.proof }))
vi.mock("@/lib/yc/staff-api", () => ({
  getStaffClaim: mocks.readClaim,
  listStaffClaims: mocks.readClaim,
}))
vi.mock("@/lib/cells", () => ({ configuredRegions: () => ["use"] }))
vi.mock("./decision-form", () => ({ DecisionForm: () => null }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: mocks.setCookie,
    delete: mocks.deleteCookie,
  }),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))

const claim = "11111111-1111-4111-8111-111111111111"
const staff = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "operator@superserve.ai",
  app_metadata: { provider: "google", providers: ["google"] },
}
const returnPath = `/admin/yc?claim=${claim}`
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("YC_STAFF_UI_ENABLED", "true")
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://console.example.com")
  mocks.getUser.mockResolvedValue({ data: { user: staff }, error: null })
  mocks.impersonation.mockResolvedValue(null)
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.readClaim.mockRejectedValue(new Error("Reauthentication required"))
  mocks.oauth.mockResolvedValue({
    data: { url: "https://accounts.google.com/authorize" },
    error: null,
  })
  mocks.proof.mockReturnValue("synthetic-init-proof")
})

async function page() {
  render(await StaffYCPage({ searchParams: Promise.resolve({ claim }) }))
}

it("offers normal sign-in with the retained claim when there is no session", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
  await page()
  expect(
    screen.getByRole("link", {
      name: "Sign in with your staff Google account",
    }),
  ).toHaveAttribute(
    "href",
    `/auth/signin?next=${encodeURIComponent(returnPath)}`,
  )
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
})

it.each([
  { ...staff, email: "operator@example.com" },
  { ...staff, app_metadata: { provider: "email", providers: ["email"] } },
])(
  "guides an ineligible existing account without a sign-in redirect loop",
  async (user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null })
    await page()
    expect(
      screen.getByRole("button", {
        name: "Sign out and use your staff account",
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Verify staff Google sign-in" }),
    ).not.toBeInTheDocument()
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("link", { name: /Sign in/ }),
    ).not.toBeInTheDocument()
    await expect(staffGoogleLogin(claim)).rejects.toThrow(
      `redirect:${returnPath}`,
    )
    expect(mocks.oauth).not.toHaveBeenCalled()
    expect(mocks.proof).not.toHaveBeenCalled()
  },
)

it("explicitly signs out only the local session and retains the claim without requiring onboarding", async () => {
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        ...staff,
        email: "customer@example.com",
        user_metadata: { onboarding_status: "selecting" },
      },
    },
    error: null,
  })
  await page()
  expect(mocks.signOut).not.toHaveBeenCalled()
  await expect(staffSignOut(claim)).rejects.toThrow(
    `redirect:/auth/signin?next=${encodeURIComponent(returnPath)}`,
  )
  expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" })
  expect(mocks.oauth).not.toHaveBeenCalled()
  expect(mocks.proof).not.toHaveBeenCalled()
})

it("keeps failed local sign-out on the guarded review page", async () => {
  mocks.signOut.mockResolvedValue({ error: { message: "unavailable" } })
  await expect(staffSignOut(claim)).rejects.toThrow(`redirect:${returnPath}`)
  expect(mocks.oauth).not.toHaveBeenCalled()
})

it("handles a thrown local sign-out failure without a server error", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.signOut.mockRejectedValue(new Error("unavailable"))
  await expect(staffSignOut(claim)).rejects.toThrow(`redirect:${returnPath}`)
  expect(log).toHaveBeenCalledWith("Staff account sign-out failed")
  log.mockRestore()
})

it("does not sign out when staff review is disabled", async () => {
  vi.stubEnv("YC_STAFF_UI_ENABLED", "false")
  await expect(staffSignOut(claim)).rejects.toThrow(`redirect:${returnPath}`)
  expect(mocks.signOut).not.toHaveBeenCalled()
})

it("requires impersonation to stop without exposing reauthentication", async () => {
  mocks.impersonation.mockResolvedValue({ teamId: "synthetic-team" })
  await page()
  expect(screen.getByText(/Stop impersonating/)).toBeInTheDocument()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
  await expect(staffGoogleLogin(claim)).rejects.toThrow(
    `redirect:${returnPath}`,
  )
  expect(mocks.oauth).not.toHaveBeenCalled()
})

it("rechecks a session that expires after rendering the eligible form", async () => {
  await page()
  expect(
    screen.getByRole("button", { name: "Verify staff Google sign-in" }),
  ).toBeInTheDocument()
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
  await expect(staffGoogleLogin(claim)).rejects.toThrow(
    `redirect:${returnPath}`,
  )
  expect(mocks.oauth).not.toHaveBeenCalled()
  expect(mocks.proof).not.toHaveBeenCalled()
  expect(mocks.setCookie).not.toHaveBeenCalled()
})

it("rejects a returned auth error even if a user is present", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: staff },
    error: { status: 401 },
  })
  expect(await staffLoginSession()).toEqual({ kind: "signin" })
  await expect(staffGoogleLogin(claim)).rejects.toThrow(
    `redirect:${returnPath}`,
  )
  expect(mocks.impersonation).not.toHaveBeenCalled()
  expect(mocks.oauth).not.toHaveBeenCalled()
})

it("fails closed with an unavailable page when the eligibility check throws", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.getUser.mockRejectedValue(new Error("network unavailable"))
  await page()
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Claim review is unavailable",
  )
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
  await expect(staffGoogleLogin(claim)).rejects.toThrow(
    `redirect:${returnPath}`,
  )
  expect(mocks.oauth).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith("Staff sign-in eligibility check failed")
  log.mockRestore()
})

it("keeps disabled staff review inert at render and submission", async () => {
  vi.stubEnv("YC_STAFF_UI_ENABLED", "false")
  await page()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
  await expect(staffGoogleLogin(claim)).rejects.toThrow(
    `redirect:${returnPath}`,
  )
  expect(mocks.getUser).not.toHaveBeenCalled()
  expect(mocks.oauth).not.toHaveBeenCalled()
})

it("preserves the eligible OAuth initiation, actor binding and secure cookies", async () => {
  await expect(staffGoogleLogin(claim)).rejects.toThrow(
    "redirect:https://accounts.google.com/authorize",
  )
  const request = mocks.oauth.mock.calls[0][0]
  const callback = new URL(request.options.redirectTo)
  expect(callback.origin).toBe("https://console.example.com")
  expect(callback.pathname).toBe("/auth/callback")
  expect(request.provider).toBe("google")
  expect(request.options.skipBrowserRedirect).toBe(true)
  expect(request.options.queryParams).toEqual({ prompt: "select_account" })
  expect(mocks.proof).toHaveBeenCalledWith(
    "yc-staff-google-init",
    { actor: staff.id, nonce: callback.searchParams.get("staff_google_nonce") },
    300,
  )
  expect(mocks.deleteCookie).toHaveBeenCalledWith("__Host-yc-staff-session")
  expect(mocks.setCookie).toHaveBeenCalledWith(
    "__Host-yc-staff-init",
    "synthetic-init-proof",
    { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 300 },
  )
})

it("continues rejecting invalid callback origins before initiating OAuth", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://console.example.com")
  await expect(staffGoogleLogin(claim)).rejects.toThrow(
    "Staff login unavailable",
  )
  expect(mocks.oauth).not.toHaveBeenCalled()
  expect(mocks.proof).not.toHaveBeenCalled()
})

it("limits stale-session return paths to staff review and a valid claim", () => {
  expect(staffReviewPath(claim)).toBe(returnPath)
  expect(staffReviewPath("https://attacker.example")).toBe("/admin/yc")
  expect(staffReviewPath("bad&next=//attacker.example")).toBe("/admin/yc")
})
