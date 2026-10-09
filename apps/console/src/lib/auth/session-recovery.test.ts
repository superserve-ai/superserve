import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getSession, getUser } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { getSession, getUser } }),
}))
import { recoverSession, redirectToSignIn } from "./session-recovery"

describe("session recovery", () => {
  beforeEach(() => {
    getSession
      .mockReset()
      .mockResolvedValue({ data: { session: {} }, error: null })
    getUser
      .mockReset()
      .mockResolvedValue({ data: { user: { id: "user" } }, error: null })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("waits for session refresh and verifies the resulting user", async () => {
    expect(await recoverSession()).toBe("authenticated")
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(getUser).toHaveBeenCalledTimes(1)
  })
  it("coalesces concurrent failures into one auth check", async () => {
    const first = recoverSession()
    expect(recoverSession()).toBe(first)
    expect(await first).toBe("authenticated")
    expect(getSession).toHaveBeenCalledTimes(1)
  })
  it("recognizes missing cookies without an unnecessary auth request", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await recoverSession()).toBe("signed-out")
    expect(getUser).not.toHaveBeenCalled()
  })
  it.each([
    "session_not_found",
    "session_expired",
    "refresh_token_not_found",
    "refresh_token_already_used",
    "user_not_found",
    "user_banned",
  ])("recognizes terminal Auth error %s", async (code) => {
    getSession.mockResolvedValue({ data: { session: null }, error: { code } })
    expect(await recoverSession()).toBe("signed-out")
  })
  it("recognizes revoked sessions even with an unexpired local token", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "session_not_found" },
    })
    expect(await recoverSession()).toBe("signed-out")
  })
  it.each([429, 500, 503, 401])(
    "does not equate an unclassified %s with session expiry",
    async (status) => {
      getUser.mockResolvedValue({ data: { user: null }, error: { status } })
      expect(await recoverSession()).toBe("unavailable")
    },
  )
  it("preserves sessions on network exceptions", async () => {
    getSession.mockRejectedValue(new TypeError("Failed to fetch"))
    expect(await recoverSession()).toBe("unavailable")
  })
  it("bounds hung auth checks and allows a later recovery", async () => {
    vi.useFakeTimers()
    getSession.mockReturnValueOnce(new Promise(() => {}))
    const pending = recoverSession()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toBe("unavailable")
    expect(await recoverSession()).toBe("authenticated")
  })
  it("preserves path, query and fragment and avoids sign-in loops", () => {
    const replace = vi.fn()
    const location = {
      pathname: "/sandboxes/",
      search: "?q=a&status=paused",
      hash: "#details",
      replace,
    }
    vi.stubGlobal("window", { location })
    redirectToSignIn()
    const target = new URL(
      replace.mock.calls[0][0],
      "https://console.example.com",
    )
    expect(target.pathname).toBe("/auth/signin")
    expect(target.searchParams.get("next")).toBe(
      "/sandboxes/?q=a&status=paused#details",
    )
    location.pathname = "/auth/signin/"
    redirectToSignIn()
    expect(replace).toHaveBeenCalledTimes(1)
  })
})
