import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The sign-in page with the real Google sign-up check: only the boundaries
// (capture, reCAPTCHA, server actions, Supabase) are mocked, so these tests
// show how long a stalled step can hold back Google OAuth.

vi.mock("@superserve/ui", () => ({
  cn: (...classes: Array<string | undefined | false>) =>
    classes.filter(Boolean).join(" "),
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button {...props} />
  ),
  Input: ({
    suffix,
    error,
    wrapperClassName: _wrapperClassName,
    ...props
  }: React.JSX.IntrinsicElements["input"] & {
    suffix?: React.ReactNode
    error?: string
    wrapperClassName?: string
  }) => (
    <div>
      <input {...props} />
      {suffix}
      {error && <p>{error}</p>}
    </div>
  ),
}))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("@/components/icons", () => ({
  GoogleIcon: () => <span>GoogleIcon</span>,
  Spinner: () => <div>spinner</div>,
}))
vi.mock("@phosphor-icons/react", () => ({
  EyeIcon: () => <span>eye</span>,
  EyeSlashIcon: () => <span>eye-slash</span>,
}))
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
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
  usePostHog: () => ({ capture: vi.fn() }),
}))

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  beginGoogleSignIn: vi.fn(),
  beginGoogleSignup: vi.fn(),
  ensureCapture: vi.fn(),
  getRecaptchaToken: vi.fn(),
  clearCapture: vi.fn(),
}))

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      signInWithOAuth: mocks.signInWithOAuth,
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      signOut: vi.fn(),
    },
  }),
}))
vi.mock("./google-action", () => ({
  beginGoogleSignIn: () => mocks.beginGoogleSignIn(),
}))
vi.mock("./link-action", () => ({ sendSignInLink: vi.fn() }))
vi.mock("@/app/(auth)/auth/signup/action", () => ({
  beginGoogleSignup: (...args: unknown[]) => mocks.beginGoogleSignup(...args),
  isCloudflareSignupObservationEnabled: () => Promise.resolve(false),
}))
vi.mock("@/lib/fingerprint/client", () => ({
  ensureFingerprintSignupCapture: () => mocks.ensureCapture(),
  getFingerprintSignupDiagnostics: () => ({ schema_version: 1, events: [] }),
  clearFingerprintSignupCapture: () => mocks.clearCapture(),
}))
vi.mock("@/lib/recaptcha/client", () => ({
  RECAPTCHA_SITE_KEY: "site-key",
  getRecaptchaToken: (action: string) => mocks.getRecaptchaToken(action),
}))

import { GOOGLE_SIGNUP_CHECK_DEADLINE_MS } from "./google-signup-check"
import SignInPage from "./page"

const capture = { attemptId: "capture-1", challenge: "c", eventId: "e" }

async function clickGoogle() {
  // Let the page's session check settle. findBy* waits on real timers.
  await act(() => vi.advanceTimersByTimeAsync(0))
  const button = screen.getByRole("button", {
    name: /Continue with Google/,
  })
  fireEvent.click(button)
  return button
}

describe("SignInPage Google sign-in with a stalled sign-up check", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.signInWithOAuth.mockReset().mockResolvedValue({ error: null })
    mocks.beginGoogleSignIn.mockReset().mockResolvedValue("signin-origin")
    mocks.ensureCapture.mockReset().mockResolvedValue(capture)
    mocks.getRecaptchaToken.mockReset().mockResolvedValue("token")
    mocks.clearCapture.mockReset()
    mocks.beginGoogleSignup
      .mockReset()
      .mockResolvedValue({ success: true, signupAttemptId: "attempt-1" })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const stalled = {
    "fingerprint capture": () =>
      mocks.ensureCapture.mockReturnValue(new Promise(() => {})),
    reCAPTCHA: () =>
      mocks.getRecaptchaToken.mockReturnValue(new Promise(() => {})),
    "proof issuance": () =>
      mocks.beginGoogleSignup.mockReturnValue(new Promise(() => {})),
  }

  it.each(Object.keys(stalled) as Array<keyof typeof stalled>)(
    "goes to Google without a sign-up attempt within the deadline when %s stalls",
    async (stage) => {
      stalled[stage]()
      render(<SignInPage />)
      const button = await clickGoogle()
      await act(() =>
        vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS - 1),
      )
      expect(mocks.signInWithOAuth).not.toHaveBeenCalled()
      expect(button).toBeDisabled()

      await act(() => vi.advanceTimersByTimeAsync(1))

      expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1)
      const callback = new URL(
        mocks.signInWithOAuth.mock.calls[0][0].options.redirectTo,
      )
      expect(callback.searchParams.has("signup_attempt_id")).toBe(false)
      expect(callback.searchParams.get("google_signin_intent")).toBe(
        "signin-origin",
      )
      expect(screen.queryByText(/Error signing in/)).not.toBeInTheDocument()
    },
  )

  it("keeps the sign-up attempt when the check finishes inside the deadline", async () => {
    render(<SignInPage />)
    await clickGoogle()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1)
    const callback = new URL(
      mocks.signInWithOAuth.mock.calls[0][0].options.redirectTo,
    )
    expect(callback.searchParams.get("signup_attempt_id")).toBe("attempt-1")
  })

  it("never sends a proof call from a stalled capture after Google OAuth has started", async () => {
    let finishCapture: (value: typeof capture) => void = () => {}
    mocks.ensureCapture.mockReturnValue(
      new Promise((resolve) => {
        finishCapture = resolve
      }),
    )
    render(<SignInPage />)
    await clickGoogle()
    await act(() =>
      vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS),
    )
    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishCapture(capture)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mocks.getRecaptchaToken).not.toHaveBeenCalled()
    expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
  })

  it("does not go to Google after the user leaves the page during the check", async () => {
    // For example, the user follows "Create an account" while the check runs.
    let finishCapture: (value: typeof capture) => void = () => {}
    mocks.ensureCapture.mockReturnValue(
      new Promise((resolve) => {
        finishCapture = resolve
      }),
    )
    const { unmount } = render(<SignInPage />)
    await clickGoogle()
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    unmount()

    await act(async () => {
      finishCapture(capture)
      await vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS)
    })

    expect(mocks.signInWithOAuth).not.toHaveBeenCalled()
    expect(mocks.beginGoogleSignup).not.toHaveBeenCalled()
  })

  it("goes to Google within the deadline when the origin action never answers", async () => {
    mocks.beginGoogleSignIn.mockReturnValue(new Promise(() => {}))
    render(<SignInPage />)
    const button = await clickGoogle()
    await act(() =>
      vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS - 1),
    )
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled()
    expect(button).toBeDisabled()

    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1)
    const callback = new URL(
      mocks.signInWithOAuth.mock.calls[0][0].options.redirectTo,
    )
    expect(callback.searchParams.has("google_signin_intent")).toBe(false)
    expect(callback.searchParams.get("signup_attempt_id")).toBe("attempt-1")
  })

  it("still reports an origin action that fails inside the deadline", async () => {
    mocks.beginGoogleSignIn.mockRejectedValue(new Error("network"))
    render(<SignInPage />)
    await clickGoogle()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText(/Error signing in/)).toBeInTheDocument()
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled()
  })

  it("does not queue a retry behind a stalled proof call (server actions run one at a time)", async () => {
    // Next.js runs the client's server actions in order. A stalled proof call
    // therefore holds back the origin action of the next try as well.
    let queue: Promise<unknown> = Promise.resolve()
    const inOrder = <T,>(run: () => Promise<T>): Promise<T> => {
      const result = queue.then(run)
      queue = result.catch(() => {})
      return result
    }
    mocks.beginGoogleSignup
      .mockReset()
      .mockImplementationOnce(() => inOrder(() => new Promise(() => {})))
      .mockImplementation(() =>
        inOrder(async () => ({ success: true, signupAttemptId: "attempt-2" })),
      )
    mocks.beginGoogleSignIn
      .mockReset()
      .mockImplementation(() => inOrder(async () => "signin-origin"))
    mocks.signInWithOAuth
      .mockReset()
      .mockResolvedValueOnce({ error: new Error("oauth down") })
      .mockResolvedValue({ error: null })

    render(<SignInPage />)
    await clickGoogle()
    await act(() =>
      vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS),
    )
    expect(screen.getByText(/Error signing in/)).toBeInTheDocument()
    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1)

    await clickGoogle()
    await act(() =>
      vi.advanceTimersByTimeAsync(GOOGLE_SIGNUP_CHECK_DEADLINE_MS),
    )

    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(2)
    const retry = new URL(
      mocks.signInWithOAuth.mock.calls[1][0].options.redirectTo,
    )
    expect(retry.searchParams.has("signup_attempt_id")).toBe(false)
    expect(screen.queryByText(/Error signing in/)).not.toBeInTheDocument()
  })
})
