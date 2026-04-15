/**
 * use-posthog-identify — ensures PostHog learns who the user is and
 * correctly forgets them on sign-out.
 *
 * Critical because the funnel relies on consistent distinct_ids — if
 * identify never fires, anonymous device_ids and post-auth events live
 * on separate person records and the funnel looks empty.
 */

import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockIdentify = vi.fn()
const mockReset = vi.fn()

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ identify: mockIdentify, reset: mockReset }),
}))

let mockUser: unknown = null
let mockLoading = false

vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: mockUser, loading: mockLoading }),
}))

import { usePostHogIdentify } from "./use-posthog-identify"

describe("usePostHogIdentify", () => {
  beforeEach(() => {
    mockIdentify.mockReset()
    mockReset.mockReset()
    mockUser = null
    mockLoading = false
  })

  afterEach(() => {
    mockUser = null
  })

  it("does nothing while loading", () => {
    mockLoading = true
    renderHook(() => usePostHogIdentify())
    expect(mockIdentify).not.toHaveBeenCalled()
    expect(mockReset).not.toHaveBeenCalled()
  })

  it("does nothing when there's no user and we've never identified", () => {
    renderHook(() => usePostHogIdentify())
    expect(mockIdentify).not.toHaveBeenCalled()
    expect(mockReset).not.toHaveBeenCalled()
  })

  it("calls identify(userId, traits) when a user is present", () => {
    mockUser = {
      id: "u-1",
      email: "u@example.com",
      user_metadata: { full_name: "User One" },
      app_metadata: { provider: "email" },
    }
    renderHook(() => usePostHogIdentify())
    expect(mockIdentify).toHaveBeenCalledWith("u-1", {
      email: "u@example.com",
      name: "User One",
      provider: "email",
    })
  })

  it("doesn't re-identify the same user twice", () => {
    mockUser = {
      id: "u-1",
      email: "u@example.com",
      user_metadata: {},
      app_metadata: {},
    }
    const { rerender } = renderHook(() => usePostHogIdentify())
    expect(mockIdentify).toHaveBeenCalledTimes(1)
    rerender()
    expect(mockIdentify).toHaveBeenCalledTimes(1)
  })

  it("re-identifies when the user id changes", () => {
    mockUser = {
      id: "u-1",
      email: "a@e.com",
      user_metadata: {},
      app_metadata: {},
    }
    const { rerender } = renderHook(() => usePostHogIdentify())
    expect(mockIdentify).toHaveBeenCalledTimes(1)
    expect(mockIdentify).toHaveBeenLastCalledWith("u-1", expect.any(Object))

    mockUser = {
      id: "u-2",
      email: "b@e.com",
      user_metadata: {},
      app_metadata: {},
    }
    rerender()
    expect(mockIdentify).toHaveBeenCalledTimes(2)
    expect(mockIdentify).toHaveBeenLastCalledWith("u-2", expect.any(Object))
  })

  it("calls reset on sign-out (after having been identified)", () => {
    mockUser = {
      id: "u-1",
      email: "a@e.com",
      user_metadata: {},
      app_metadata: {},
    }
    const { rerender } = renderHook(() => usePostHogIdentify())
    expect(mockIdentify).toHaveBeenCalledTimes(1)

    mockUser = null
    rerender()
    expect(mockReset).toHaveBeenCalledTimes(1)
  })
})
