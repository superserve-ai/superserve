import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()
const router = { replace }
const check = vi.fn()
let params = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => params,
}))
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("./actions", () => ({
  checkSignupPaymentAction: (...args: unknown[]) => check(...args),
}))

import { PaymentWait } from "./payment-wait"

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe("signup payment wait", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    params = new URLSearchParams({ account: "u1", team: "use:team-1" })
    replace.mockReset()
    check.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("polls every 1.5 s and opens the console the moment the plan is active", async () => {
    check
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue("/sandboxes")
    render(<PaymentWait />)
    await advance(0)
    expect(check).toHaveBeenCalledExactlyOnceWith("u1", "use:team-1")
    expect(screen.getByText("Processing payment…")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
    await advance(1499)
    expect(check).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(check).toHaveBeenCalledTimes(2)
    await advance(1500)
    expect(replace).toHaveBeenCalledExactlyOnceWith("/sandboxes")
    await advance(10_000)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it("checks again when Back restores the page after leaving for Stripe", async () => {
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {})
    check.mockResolvedValueOnce("https://checkout.stripe.com/c/pay/cs_method")
    check.mockResolvedValue(null)
    render(<PaymentWait />)
    await advance(10_000)
    expect(assign).toHaveBeenCalledOnce()
    expect(check).toHaveBeenCalledTimes(1)
    await act(async () => {
      window.dispatchEvent(
        Object.assign(new Event("pageshow"), { persisted: true }),
      )
    })
    await advance(0)
    expect(check).toHaveBeenCalledTimes(2)
    assign.mockRestore()
  })

  it("keeps waiting through a failed check", async () => {
    check.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null)
    render(<PaymentWait />)
    await advance(1500)
    expect(check).toHaveBeenCalledTimes(2)
    expect(screen.getByText("Processing payment…")).toBeTruthy()
  })

  it("stops after two minutes with a calm retry, then waits again on retry", async () => {
    check.mockResolvedValue(null)
    render(<PaymentWait />)
    await advance(120_000)
    expect(screen.getByText(/still being confirmed/)).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    const polled = check.mock.calls.length
    await advance(30_000)
    expect(check).toHaveBeenCalledTimes(polled)
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await advance(0)
    expect(check).toHaveBeenCalledTimes(polled + 1)
    expect(screen.getByText("Processing payment…")).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it("checks nothing without the checkout it was opened for", async () => {
    params = new URLSearchParams()
    render(<PaymentWait />)
    await advance(5000)
    expect(check).not.toHaveBeenCalled()
    expect(screen.getByRole("link", { name: "Back to console" })).toBeTruthy()
  })
})
