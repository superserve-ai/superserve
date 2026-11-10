import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const recaptcha = vi.hoisted(() => ({
  siteKey: undefined as string | undefined,
  getToken: vi.fn(),
}))
const mockSendPasswordResetEmail = vi.fn()
const mockCapture = vi.fn()

vi.mock("@superserve/ui", () => ({
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button {...props} />
  ),
  Input: ({
    error,
    ...props
  }: React.JSX.IntrinsicElements["input"] & { error?: string }) => (
    <div>
      <input {...props} />
      {error && <p>{error}</p>}
    </div>
  ),
}))
vi.mock("@/components/corner-brackets", () => ({
  CornerBrackets: () => null,
}))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("@/components/icons", () => ({
  Spinner: () => <span>spin</span>,
}))
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}))
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))
vi.mock("next/script", () => ({ default: () => null }))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))
vi.mock("@/lib/recaptcha/client", () => ({
  get RECAPTCHA_SITE_KEY() {
    return recaptcha.siteKey
  },
  getRecaptchaToken: (...args: unknown[]) => recaptcha.getToken(...args),
}))
vi.mock("./action", () => ({
  sendPasswordResetEmail: (...args: unknown[]) =>
    mockSendPasswordResetEmail(...args),
}))

import ForgotPasswordPage from "./page"

function submit(email = "user@example.com") {
  render(<ForgotPasswordPage />)
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: email },
  })
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }))
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    recaptcha.siteKey = undefined
    recaptcha.getToken.mockReset().mockResolvedValue(undefined)
    mockSendPasswordResetEmail.mockReset().mockResolvedValue({ success: true })
    mockCapture.mockReset()
  })

  it("sends the reCAPTCHA token and shows the sent state", async () => {
    recaptcha.siteKey = "site-key"
    recaptcha.getToken.mockResolvedValue("recaptcha-token")

    submit()

    expect(await screen.findByText("Check Your Email")).toBeTruthy()
    expect(recaptcha.getToken).toHaveBeenCalledWith("password_reset")
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      "user@example.com",
      "recaptcha-token",
    )
    expect(mockCapture).toHaveBeenCalledOnce()
  })

  it("asks the user to allow the bot-check when it cannot load", async () => {
    recaptcha.siteKey = "site-key"

    submit()

    expect(
      await screen.findByText(
        "Our bot check didn't load. Turn off ad or content blockers for this site, then try again.",
      ),
    ).toBeTruthy()
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it.each([
    {
      error: new TypeError("Failed to fetch"),
      copy: "We couldn't send the reset email. Check your connection and try again.",
    },
    {
      error: new Error("An unexpected response was received from the server."),
      copy: "We couldn't send the reset email. Try again in a minute.",
    },
  ])(
    "shows the expected reset email error for $error",
    async ({ error, copy }) => {
      mockSendPasswordResetEmail.mockRejectedValue(error)

      submit()

      expect(await screen.findByText(copy)).toBeTruthy()
      expect(screen.queryByText("Check Your Email")).toBeNull()
      expect(
        screen.getByRole("button", { name: "Send reset link" }),
      ).toBeEnabled()
    },
  )

  it("shows the server error and stays on the form", async () => {
    mockSendPasswordResetEmail.mockResolvedValue({
      success: false,
      error: "Too many reset requests. Try again in a few minutes.",
      errorCode: "rate_limited",
    })

    submit()

    expect(
      await screen.findByText(
        "Too many reset requests. Try again in a few minutes.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText("Check Your Email")).toBeNull()
    expect(mockCapture).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send reset link" }),
      ).toHaveProperty("disabled", false),
    )
  })
})
