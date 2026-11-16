import { act, renderHook } from "@testing-library/react"
import type { FormEvent } from "react"
import { describe, expect, it, vi } from "vitest"

import { createSharedSubmitOnce } from "./use-submit-once"

describe("createSharedSubmitOnce", () => {
  it("resets only after the last subscriber unmounts", () => {
    const useSharedSubmitOnce = createSharedSubmitOnce()
    const first = renderHook(useSharedSubmitOnce)
    const second = renderHook(useSharedSubmitOnce)
    const event = { preventDefault: vi.fn() } as unknown as FormEvent

    act(() => first.result.current.onSubmit(event))
    expect(first.result.current.submitting).toBe(true)
    expect(second.result.current.submitting).toBe(true)
    first.unmount()
    expect(second.result.current.submitting).toBe(true)
    second.unmount()

    const next = renderHook(useSharedSubmitOnce)
    expect(next.result.current.submitting).toBe(false)
    act(() => next.result.current.onSubmit(event))
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(next.result.current.submitting).toBe(true)
  })

  it("resets on a back-forward cache restore", () => {
    const useSharedSubmitOnce = createSharedSubmitOnce()
    const { result } = renderHook(useSharedSubmitOnce)
    const event = { preventDefault: vi.fn() } as unknown as FormEvent
    act(() => result.current.onSubmit(event))

    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow")))
    expect(result.current.submitting).toBe(true)
    const restore = new Event("pageshow")
    Object.defineProperty(restore, "persisted", { value: true })
    act(() => window.dispatchEvent(restore))
    expect(result.current.submitting).toBe(false)
    act(() => result.current.onSubmit(event))
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
