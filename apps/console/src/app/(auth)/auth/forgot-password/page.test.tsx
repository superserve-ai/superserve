import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ send: vi.fn(), next: vi.fn() }))
vi.mock("./action", () => ({ sendPasswordResetEmail: mocks.send }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: mocks.next }),
}))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))

import ForgotPasswordPage from "./page"

beforeEach(() => vi.resetAllMocks())
describe("forgot-password invite return path", () => {
  it("passes a validated invite to the action, locks input and masks the echoed email", async () => {
    const invite = `/invite/ssinv_use_${"T".repeat(43)}`
    mocks.next.mockReturnValue(invite)
    let resolve!: () => void
    mocks.send.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Link" }))
    expect(mocks.send).toHaveBeenCalledWith("person@example.com", invite)
    expect(screen.getByPlaceholderText("Email")).toBeDisabled()
    resolve()
    expect(await screen.findByText("person@example.com")).toHaveAttribute(
      "data-mask",
    )
    const back = screen.getByRole("link", { name: "Back to sign in" })
    expect(back).toHaveClass("ph-no-capture")
    expect(
      new URL(
        back.getAttribute("href")!,
        "https://console.example.com",
      ).searchParams.get("next"),
    ).toBe(invite)
  })
  it("drops non-invite paths", async () => {
    mocks.next.mockReturnValue("/sandboxes")
    mocks.send.mockResolvedValue({ success: true })
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Link" }))
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith("person@example.com", undefined),
    )
  })
})
