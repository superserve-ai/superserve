import { beforeEach, expect, it, vi } from "vitest"
const m = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(url), { redirect: true })
  },
  unstable_rethrow: (error: { redirect?: boolean }) => {
    if (error.redirect) throw error
  },
}))
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: m.prepare,
}))
import { GET } from "./route"
beforeEach(() => {
  vi.clearAllMocks()
  m.prepare.mockResolvedValue({ state: "selecting" })
})
it("provisions before redirecting with the original checkout identity", async () => {
  await expect(
    GET(
      new Request(
        "https://console.test/api/onboarding/prepare/?team=use%3Ateam&account=owner&billing=cancel",
      ),
    ),
  ).rejects.toThrow(
    "/onboarding/plan/?team=use%3Ateam&account=owner&billing=cancel&setup_attempted=1",
  )
  expect(m.prepare).toHaveBeenCalledWith("use:team", "owner", "cancel")
})
it("returns to recovery after an error without accepting a redirect destination", async () => {
  m.prepare.mockRejectedValue(new Error("Unavailable"))
  await expect(
    GET(
      new Request(
        "https://console.test/api/onboarding/prepare/?next=https://evil.test",
      ),
    ),
  ).rejects.toThrow("/onboarding/plan/?&setup_error=1")
})
it("preserves authentication and Google proof recovery redirects", async () => {
  m.prepare.mockRejectedValue(
    Object.assign(new Error("/auth/signup?complete_google=1"), {
      redirect: true,
    }),
  )
  await expect(
    GET(new Request("https://console.test/api/onboarding/prepare/")),
  ).rejects.toThrow("/auth/signup?complete_google=1")
})
