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
  expect(m.prepare).toHaveBeenCalledWith(
    "use:team",
    "owner",
    "cancel",
    undefined,
  )
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

it.each([
  "/plan-usage/buy-credit/",
  "/billing/pro/?team=use%3Aoriginal&billing=success",
])(
  "retries preparation and preserves the authorized paid continuation %s",
  async (next) => {
    const url = new URL("https://console.test/api/onboarding/prepare/")
    url.searchParams.set("next", next)
    url.searchParams.set("account", "owner")
    await expect(GET(new Request(url))).rejects.toThrow(next)
    expect(m.prepare).toHaveBeenCalledWith(
      new URL(next, url).searchParams.get("team") ?? undefined,
      "owner",
      undefined,
      next,
    )
    m.prepare.mockRejectedValueOnce(new Error("Response lost"))
    const failure = await GET(new Request(url)).catch(
      (error) => new URL(error.message, url),
    )
    if (!failure) throw new Error("Expected setup recovery redirect")
    expect(failure.pathname).toBe("/auth/auth-code-error")
    expect(failure.searchParams.get("next")).toBe(next)
    expect(failure.searchParams.get("account")).toBe("owner")
  },
)
it.each([
  "https://evil.test",
  "//evil.test",
  "/billing/pro?approved=true",
  "/sandboxes",
  "/auth/pending",
])("does not accept arbitrary preparation continuation %s", async (next) => {
  const url = new URL("https://console.test/api/onboarding/prepare/")
  url.searchParams.set("next", next)
  url.searchParams.set("account", "owner")
  await expect(GET(new Request(url))).rejects.toThrow(
    "/onboarding/plan/?account=owner&setup_attempted=1",
  )
})
it("requires the authenticated account binding for a paid continuation", async () => {
  await expect(
    GET(
      new Request(
        "https://console.test/api/onboarding/prepare/?next=%2Fbilling%2Fpro%2F",
      ),
    ),
  ).rejects.toThrow("/onboarding/plan/?&setup_attempted=1")
})

it("rejects conflicting checkout team locators before preparation", async () => {
  const url = new URL(
    "https://console.test/api/onboarding/prepare/?account=owner&team=use%3Aother",
  )
  url.searchParams.set(
    "next",
    "/billing/pro/?team=use%3Aoriginal&billing=success",
  )
  await expect(GET(new Request(url))).rejects.toThrow("reason=team_conflict")
  expect(m.prepare).not.toHaveBeenCalled()
})
