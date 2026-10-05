import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { getData, register, useVisitorData } = vi.hoisted(() => ({
  getData: vi.fn(),
  register: vi.fn(),
  useVisitorData: vi.fn(),
}))
vi.mock("@fingerprint/react", () => ({ useVisitorData }))
vi.mock("@/lib/fingerprint/client", () => ({
  registerFingerprintGetData: register,
}))

import { FingerprintSignupObserver } from "./fingerprint-signup-observer"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("signup agent registration", () => {
  it("does not capture on mount or while the user fills out the form", () => {
    vi.stubEnv("NEXT_PUBLIC_FINGERPRINT_API_KEY", "test-public-key")
    vi.useFakeTimers()
    useVisitorData.mockReturnValue({ getData })
    const { container } = render(<FingerprintSignupObserver />)
    vi.advanceTimersByTime(6 * 60_000)
    expect(useVisitorData).toHaveBeenCalledWith({ immediate: false })
    expect(register).toHaveBeenCalledWith(getData)
    expect(getData).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it("does not initialize the provider when unconfigured", () => {
    vi.stubEnv("NEXT_PUBLIC_FINGERPRINT_API_KEY", "")
    render(<FingerprintSignupObserver />)
    expect(useVisitorData).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })
})
