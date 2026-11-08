import { render } from "@testing-library/react"
import { motion, useReducedMotion } from "motion/react"
import type { HTMLMotionProps } from "motion/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Spinner } from "./icons"

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>()
  return {
    ...actual,
    useReducedMotion: vi.fn(),
    motion: {
      ...actual.motion,
      div: vi.fn(({ className }: HTMLMotionProps<"div">) => (
        <div className={className} />
      )),
    },
  }
})

describe("Spinner", () => {
  beforeEach(() => {
    vi.mocked(motion.div).mockClear()
  })

  it("keeps the ring without rotation when reduced motion is on", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    const { container } = render(<Spinner className="border-primary" />)

    expect(motion.div).toHaveBeenCalledWith(
      expect.objectContaining({
        animate: undefined,
        transition: undefined,
      }),
      undefined,
    )
    expect(container.firstChild).toHaveAttribute(
      "class",
      "h-5 w-5 rounded-full border-2 border-t-transparent border-primary",
    )
  })

  it("keeps the repeating rotation when reduced motion is off", () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const { container } = render(<Spinner />)

    expect(motion.div).toHaveBeenCalledWith(
      expect.objectContaining({
        animate: { rotate: 360 },
        transition: { duration: 0.8, repeat: Infinity, ease: "linear" },
      }),
      undefined,
    )
    expect(container.firstChild).toHaveAttribute(
      "class",
      "h-5 w-5 rounded-full border-2 border-t-transparent border-white",
    )
  })
})
