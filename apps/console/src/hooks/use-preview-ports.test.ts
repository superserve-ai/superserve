import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { AddPortResult } from "./use-preview-ports"
import {
  isValidPreviewPort,
  MAX_PREVIEW_PORT,
  MAX_PREVIEW_PORTS,
  MIN_PREVIEW_PORT,
  usePreviewPorts,
} from "./use-preview-ports"

const SANDBOX_ID = "sbx-1"

describe("isValidPreviewPort", () => {
  it("accepts integers within [MIN, MAX]", () => {
    expect(isValidPreviewPort(MIN_PREVIEW_PORT)).toBe(true)
    expect(isValidPreviewPort(3000)).toBe(true)
    expect(isValidPreviewPort(MAX_PREVIEW_PORT)).toBe(true)
  })

  it("rejects privileged, out-of-range, and non-integer ports", () => {
    expect(isValidPreviewPort(80)).toBe(false)
    expect(isValidPreviewPort(MIN_PREVIEW_PORT - 1)).toBe(false)
    expect(isValidPreviewPort(MAX_PREVIEW_PORT + 1)).toBe(false)
    expect(isValidPreviewPort(3000.5)).toBe(false)
  })
})

describe("usePreviewPorts", () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  describe("initialization", () => {
    it("starts empty when storage is empty", () => {
      const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID))
      expect(result.current.ports).toEqual([])
      expect(result.current.canAddPort).toBe(true)
    })

    it("restores ports from storage, dropping invalid and duplicate entries", () => {
      window.localStorage.setItem(
        "superserve.preview-ports.sbx-1",
        JSON.stringify([3000, 3000, 80, "x", 8080]),
      )
      const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID))
      expect(result.current.ports).toEqual([3000, 8080])
    })
  })

  describe("addPort", () => {
    it("adds a valid port and reports success", () => {
      const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID))
      let res: AddPortResult | undefined
      act(() => {
        res = result.current.addPort(3000)
      })
      expect(res?.ok).toBe(true)
      expect(result.current.ports).toEqual([3000])
    })

    it("rejects an out-of-range port without adding it", () => {
      const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID))
      let res: AddPortResult | undefined
      act(() => {
        res = result.current.addPort(80)
      })
      expect(res?.ok).toBe(false)
      expect(res?.error).toBeTruthy()
      expect(result.current.ports).toEqual([])
    })

    // Guards the fix for the async-updater bug: the duplicate result must be
    // reported synchronously from addPort, not only inside the setPorts updater.
    it("reports a duplicate port synchronously without re-adding it", () => {
      const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID))
      act(() => {
        result.current.addPort(3000)
      })
      let res: AddPortResult | undefined
      act(() => {
        res = result.current.addPort(3000)
      })
      expect(res?.ok).toBe(false)
      expect(res?.error).toContain("already added")
      expect(result.current.ports).toEqual([3000])
    })

    it("stops adding past the cap and flips canAddPort", () => {
      const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID))
      act(() => {
        for (let i = 0; i < MAX_PREVIEW_PORTS; i++) {
          result.current.addPort(MIN_PREVIEW_PORT + i)
        }
      })
      expect(result.current.ports).toHaveLength(MAX_PREVIEW_PORTS)
      expect(result.current.canAddPort).toBe(false)

      let res: AddPortResult | undefined
      act(() => {
        res = result.current.addPort(60000)
      })
      expect(res?.ok).toBe(false)
      expect(result.current.ports).toHaveLength(MAX_PREVIEW_PORTS)
    })
  })

  describe("removePort", () => {
    it("removes a previously added port", () => {
      const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID))
      act(() => {
        result.current.addPort(3000)
        result.current.addPort(8080)
      })
      act(() => {
        result.current.removePort(3000)
      })
      expect(result.current.ports).toEqual([8080])
    })
  })

  describe("persistence & isolation", () => {
    it("persists ports across remounts for the same sandbox", () => {
      const first = renderHook(() => usePreviewPorts(SANDBOX_ID))
      act(() => {
        first.result.current.addPort(3000)
      })
      first.unmount()

      const second = renderHook(() => usePreviewPorts(SANDBOX_ID))
      expect(second.result.current.ports).toEqual([3000])
    })

    it("keeps separate lists per sandbox id", () => {
      const { result, rerender } = renderHook(({ id }) => usePreviewPorts(id), {
        initialProps: { id: "sbx-a" },
      })
      act(() => {
        result.current.addPort(3000)
      })

      rerender({ id: "sbx-b" })
      expect(result.current.ports).toEqual([])
      act(() => {
        result.current.addPort(8080)
      })

      rerender({ id: "sbx-a" })
      expect(result.current.ports).toEqual([3000])
    })
  })
})
