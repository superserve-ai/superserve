import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  capture: vi.fn(),
  reset: vi.fn(),
  signOut: vi.fn(),
  markSigningOut: vi.fn(),
  clearSigningOut: vi.fn(),
  clearTerminalTabsStorage: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock("posthog-js/react", () => ({ usePostHog: () => mocks }))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signOut: mocks.signOut } }),
}))
vi.mock("@/components/layout/session-expiry-redirect", () => ({
  markSigningOut: mocks.markSigningOut,
  clearSigningOut: mocks.clearSigningOut,
}))
vi.mock("@/lib/terminal-tabs-storage", () => ({
  clearTerminalTabsStorage: mocks.clearTerminalTabsStorage,
}))

import { useSignOut } from "./use-sign-out"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signOut.mockReset().mockResolvedValue({ error: null })
})

describe("useSignOut", () => {
  it.each([
    undefined,
    "/api/onboarding/checkout/return/?account=user&team=use%3Ateam",
  ])("signs out and preserves the optional return path (%s)", async (next) => {
    const { result } = renderHook(() => useSignOut())
    await act(() => result.current(next))
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
      next ? `/auth/signin?next=${encodeURIComponent(next)}` : "/auth/signin",
    )
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith("auth_sign_out")
    expect(mocks.markSigningOut).toHaveBeenCalledTimes(1)
    expect(mocks.clearSigningOut).not.toHaveBeenCalled()
    expect(mocks.clearTerminalTabsStorage).toHaveBeenCalledTimes(1)
    expect(mocks.reset).toHaveBeenCalledTimes(1)
  })

  it.each(["throws", "resolves with an error"])(
    "rejects without clearing browser state or navigating with a return path when sign-out %s",
    async (failure) => {
      const error = new Error("Unavailable")
      if (failure === "throws") mocks.signOut.mockRejectedValue(error)
      else mocks.signOut.mockResolvedValue({ error })
      const { result } = renderHook(() => useSignOut())
      await act(async () => {
        await expect(
          result.current("/checkout?team=use:team"),
        ).rejects.toBeInstanceOf(Error)
      })
      expect(mocks.signOut).toHaveBeenCalledTimes(1)
      expect(mocks.clearSigningOut).toHaveBeenCalledTimes(1)
      expect(mocks.push).not.toHaveBeenCalled()
      expect(mocks.clearTerminalTabsStorage).not.toHaveBeenCalled()
      expect(mocks.reset).not.toHaveBeenCalled()
    },
  )

  it.each(["throws", "resolves with an error"])(
    "still clears browser state and navigates without a return path when sign-out %s",
    async (failure) => {
      const error = new Error("Unavailable")
      if (failure === "throws") mocks.signOut.mockRejectedValue(error)
      else mocks.signOut.mockResolvedValue({ error })
      const { result } = renderHook(() => useSignOut())
      await act(() => result.current())
      expect(mocks.signOut).toHaveBeenCalledTimes(1)
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/auth/signin")
      expect(mocks.clearSigningOut).not.toHaveBeenCalled()
      expect(mocks.clearTerminalTabsStorage).toHaveBeenCalledTimes(1)
      expect(mocks.reset).toHaveBeenCalledTimes(1)
    },
  )
})
