import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const recaptcha = vi.hoisted(() => ({
  siteKey: undefined as string | undefined,
  getToken: vi.fn(),
}))
const mockSendPasswordResetEmail = vi.fn()
const mockCapture = vi.fn()
const mockSearchParam = vi.fn()

vi.mock("@superserve/ui", () => ({
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button {...props} />
  ),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
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
    className,
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: mockSearchParam }),
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
    mockSearchParam.mockReset().mockReturnValue(null)
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
      undefined,
    )
    expect(mockCapture).toHaveBeenCalledOnce()
  })

  it("asks the user to allow the bot-check when it cannot load", async () => {
    recaptcha.siteKey = "site-key"

    submit()

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Our bot check couldn't finish. Turn off ad blockers for this site, then refresh the page.",
    )
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

  it("clears the error alert while retrying and restores it on the same failure", async () => {
    const failure = {
      success: false,
      error: "Too many reset requests. Try again in a few minutes.",
      errorCode: "rate_limited",
    }
    let resolveRetry!: (value: typeof failure) => void
    mockSendPasswordResetEmail
      .mockResolvedValueOnce(failure)
      .mockReturnValueOnce(
        new Promise<typeof failure>((resolve) => {
          resolveRetry = resolve
        }),
      )

    submit()

    expect(await screen.findByRole("alert")).toHaveTextContent(failure.error)
    expect(screen.getAllByRole("alert")).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }))

    await waitFor(() =>
      expect(mockSendPasswordResetEmail).toHaveBeenCalledTimes(2),
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    resolveRetry(failure)

    expect(await screen.findByRole("alert")).toHaveTextContent(failure.error)
    expect(screen.getAllByRole("alert")).toHaveLength(1)
  })
})

describe("forgot-password invite return path", () => {
  beforeEach(() => {
    recaptcha.siteKey = undefined
    recaptcha.getToken.mockReset().mockResolvedValue(undefined)
    mockSendPasswordResetEmail.mockReset().mockResolvedValue({ success: true })
    mockCapture.mockReset()
    mockSearchParam.mockReset()
  })

  it("passes a validated invite to the action, locks input and masks the echoed email", async () => {
    const invite = `/invite/ssinv_use_${"T".repeat(43)}`
    mockSearchParam.mockReturnValue(invite)
    let resolve!: (value: { success: true }) => void
    mockSendPasswordResetEmail.mockImplementation(
      () =>
        new Promise<{ success: true }>((done) => {
          resolve = done
        }),
    )

    submit("person@example.com")

    await waitFor(() =>
      expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
        "person@example.com",
        undefined,
        invite,
      ),
    )
    expect(screen.getByPlaceholderText("Email")).toHaveProperty(
      "disabled",
      true,
    )
    resolve({ success: true })
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
    mockSearchParam.mockReturnValue("/sandboxes")

    submit("person@example.com")

    await waitFor(() =>
      expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
        "person@example.com",
        undefined,
        undefined,
      ),
    )
  })
})
