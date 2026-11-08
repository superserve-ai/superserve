import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("MotionProvider", () => {
  it("follows the user preference with reduced motion on and off", async () => {
    vi.resetModules()
    const listeners = new Set<() => void>()
    const media = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn((listener: () => void) => listeners.add(listener)),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_event: string, listener: () => void) =>
        listeners.add(listener),
      ),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
    const matchMedia = vi.fn(() => media)
    vi.stubGlobal("matchMedia", matchMedia)

    const { MotionConfig, useReducedMotionConfig } =
      await import("motion/react")
    const { MotionProvider } = await import("./motion-provider")

    function Preference() {
      return <output>{String(useReducedMotionConfig())}</output>
    }

    // Motion caches the first matchMedia result; notify its listener before
    // mounting a fresh reader for each preference.
    for (const matches of [true, false]) {
      media.matches = matches
      listeners.forEach((listener) => listener())
      const { unmount } = render(
        <MotionConfig reducedMotion="always">
          <MotionProvider>
            <Preference />
          </MotionProvider>
        </MotionConfig>,
      )

      expect(matchMedia).toHaveBeenCalled()
      expect(screen.getByRole("status")).toHaveTextContent(String(matches))
      unmount()
    }
  })
})
