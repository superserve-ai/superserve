import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  capture: vi.fn(),
  reset: vi.fn(),
  signOut: vi.fn(),
  markSigningOut: vi.fn(),
  clearTerminalTabsStorage: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock("posthog-js/react", () => ({ usePostHog: () => mocks }))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signOut: mocks.signOut } }),
}))
vi.mock("@/components/layout/session-expiry-redirect", () => ({
  markSigningOut: mocks.markSigningOut,
}))
vi.mock("@/lib/terminal-tabs-storage", () => ({
  clearTerminalTabsStorage: mocks.clearTerminalTabsStorage,
}))

import { useSignOut } from "./use-sign-out"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signOut.mockReset().mockResolvedValue(undefined)
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
    expect(mocks.clearTerminalTabsStorage).toHaveBeenCalledTimes(1)
    expect(mocks.reset).toHaveBeenCalledTimes(1)
  })

  it("keeps the return path when sign-out fails", async () => {
    mocks.signOut.mockRejectedValue(new Error("Unavailable"))
    const { result } = renderHook(() => useSignOut())
    await act(() => result.current("/checkout?team=use:team"))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
      "/auth/signin?next=%2Fcheckout%3Fteam%3Duse%3Ateam",
    )
  })
})
