import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks ---

// @superserve/ui — mock only the pieces the page uses. Input renders its
// `error` prop visibly (like the real component), so assertions can search
// by text instead of needing aria lookups. Button honors `render` like the
// real component, so a link-styled button renders as its link.
vi.mock("@superserve/ui", async () => {
  const { cloneElement } = await import("react")
  return {
    cn: (...classes: Array<string | undefined | false>) =>
      classes.filter(Boolean).join(" "),
    Button: ({
      render,
      ...props
    }: React.JSX.IntrinsicElements["button"] & {
      render?: React.ReactElement
    }) => (render ? cloneElement(render, props) : <button {...props} />),
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
  }
})

// Decorative components the page pulls in — render nothing.
vi.mock("@/components/corner-brackets", () => ({
  CornerBrackets: () => null,
}))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("@/components/icons", () => ({
  GoogleIcon: () => <span>GoogleIcon</span>,
  Spinner: ({ className }: { className?: string }) => (
    <div className={className}>spinner</div>
  ),
}))

// Phosphor icons — used inside the password visibility toggle.
vi.mock("@phosphor-icons/react", () => ({
  EyeIcon: () => <span>eye</span>,
  EyeSlashIcon: () => <span>eye-slash</span>,
}))

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
  }: {
    alt: string
    src: string
    width?: number
    height?: number
    className?: string
  }) => <img alt={alt} src={src} />,
}))

let mockReplace: ReturnType<typeof vi.spyOn>
let searchParamsMap: Record<string, string> = {}

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => searchParamsMap[key] ?? null,
  }),
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    onClick,
  }: {
    children: React.ReactNode
    href: string
    className?: string
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
  }) => (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault()
        onClick?.(e)
      }}
    >
      {children}
    </a>
  ),
}))

vi.mock("next/script", () => ({ default: () => null }))

const mockCapture = vi.fn()
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

const mockSignInWithPassword = vi.fn()
const mockSignInWithOAuth = vi.fn()
const mockGetUser = vi.fn()
const mockSignOut = vi.fn()
const mockBeginGoogleSignIn = vi.fn()
vi.mock("./google-action", () => ({
  beginGoogleSignIn: () => mockBeginGoogleSignIn(),
}))
const mockGoogleSignupAttempt = vi.fn()
const mockPrefetchGoogleSignupCheck = vi.fn()
vi.mock("./google-signup-check", () => ({
  GOOGLE_SIGNUP_CHECK_DEADLINE_MS: 4000,
  cancelGoogleSignupCheck: () => {},
  googleSignupAttemptForSignIn: () => mockGoogleSignupAttempt(),
  prefetchGoogleSignupCheck: () => mockPrefetchGoogleSignupCheck(),
}))
const mockClearFingerprintCapture = vi.fn()
vi.mock("@/lib/fingerprint/client", () => ({
  clearFingerprintSignupCapture: () => mockClearFingerprintCapture(),
}))
const mockSendSignInLink = vi.fn()
vi.mock("./link-action", () => ({
  sendSignInLink: (...args: unknown[]) => mockSendSignInLink(...args),
}))

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signInWithOAuth: mockSignInWithOAuth,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}))

import SignInPage from "./page"

describe("SignInPage", () => {
  const user = userEvent.setup()

  it.each([
    `/invite/ssinv_use_${"T".repeat(43)}`,
    "/sandboxes",
    "/invite/invalid",
  ])("keeps only a validated invite on Forgot password (%s)", (next) => {
    searchParamsMap = { next }
    render(<SignInPage />)
    const link = screen.getByRole("link", { name: "Forgot password?" })
    const url = new URL(
      link.getAttribute("href")!,
      "https://console.example.com",
    )
    expect(url.pathname).toBe("/auth/forgot-password")
    expect(url.searchParams.get("next")).toBe(
      next.startsWith("/invite/ssinv_") ? next : null,
    )
    expect(link.classList.contains("ph-no-capture")).toBe(
      next.startsWith("/invite/ssinv_"),
    )
  })

  beforeEach(() => {
    mockReplace = vi
      .spyOn(window.location, "replace")
      .mockImplementation(() => {})
    mockSignInWithPassword.mockReset()
    mockSignInWithOAuth.mockReset()
    mockSignOut.mockReset()
    mockBeginGoogleSignIn.mockReset().mockResolvedValue("signin-origin")
    mockGoogleSignupAttempt.mockReset().mockResolvedValue(undefined)
    mockPrefetchGoogleSignupCheck.mockReset()
    mockClearFingerprintCapture.mockReset()
    mockCapture.mockReset()
    mockSendSignInLink.mockReset().mockResolvedValue({ success: true })
    searchParamsMap = {}
    // Default: no existing session
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })
  })

  it.each([
    ["starter", "/sandboxes"],
    ["starter_monthly", "/sandboxes"],
    ["pro_annual", "/billing/pro/"],
    ["pro_monthly", "/billing/pro/"],
    ["free", "/sandboxes"],
  ])("keeps %s intent after password sign-in", async (offer, destination) => {
    searchParamsMap = { offer }
    mockSignInWithPassword.mockResolvedValue({ error: null })
    render(<SignInPage />)
    await user.type(
      await screen.findByPlaceholderText("Email"),
      "person@example.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "example-password")
    await user.click(screen.getByRole("button", { name: "Sign In" }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(destination))
  })

  it("keeps selected intent for an already signed-in customer", async () => {
    searchParamsMap = { signup_offer: "starter" }
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    })
    render(<SignInPage />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/sandboxes"))
  })

  it.each([
    ["starter_monthly", "/sandboxes"],
    ["pro_annual", "/billing/pro/"],
  ])(
    "restores %s navigation for an existing session",
    async (offer, destination) => {
      searchParamsMap = { signup_offer: offer }
      mockGetUser.mockResolvedValue({
        data: { user: { id: "existing-user" } },
        error: null,
      })
      render(<SignInPage />)
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(destination))
    },
  )

  it.each(["unknown_offer", "enterprise", "yc_2026"])(
    "does not promote %s fallback into password sign-in routing",
    async (offer) => {
      searchParamsMap = { offer }
      mockGetUser.mockResolvedValue({
        data: { user: { id: "existing-user" } },
        error: null,
      })
      render(<SignInPage />)
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"))
    },
  )

  it("renders the signin form", async () => {
    render(<SignInPage />)

    expect(await screen.findByText("Sign in to Superserve")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeInTheDocument()
  })

  it("shows inline errors when submitting with empty fields", async () => {
    render(<SignInPage />)

    await user.click(await screen.findByRole("button", { name: "Sign In" }))

    expect(await screen.findByText("Email is required.")).toBeInTheDocument()
    expect(mockSignInWithPassword).not.toHaveBeenCalled()
  })

  it("shows a password-required error when only email is filled", async () => {
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    expect(await screen.findByText("Password is required.")).toBeInTheDocument()
    expect(mockSignInWithPassword).not.toHaveBeenCalled()
  })

  it("calls signInWithPassword and redirects on success", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "test@test.com",
        password: "password123",
      })
      expect(mockReplace).toHaveBeenCalledWith("/")
    })
    expect(screen.getByRole("button", { name: /Signing in/ })).toBeDisabled()
  })

  it("redirects to next URL after successful login", async () => {
    searchParamsMap = { next: "/sandboxes?view=active#list" }
    mockSignInWithPassword.mockResolvedValue({ error: null })
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/sandboxes?view=active#list")
    })
  })

  it.each([
    "https://example.com/",
    "//example.com/",
    "/\\example.com/",
    "/\t/example.com/",
    "javascript:alert(1)",
  ])("rejects unsafe next destination %j", async (next) => {
    searchParamsMap = { next }
    mockSignInWithPassword.mockResolvedValue({ error: null })
    render(<SignInPage />)
    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Sign In" }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"))
  })

  it("shows invalid-credentials inline error on wrong password", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    })
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "wrongpassword")
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    expect(
      await screen.findByText("Invalid email or password."),
    ).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("shows email-not-confirmed inline error", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Email not confirmed" },
    })
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    expect(
      await screen.findByText("Please verify your email before signing in."),
    ).toBeInTheDocument()
  })

  it("shows generic error on unexpected failure", async () => {
    mockSignInWithPassword.mockRejectedValue(new Error("network failure"))
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    expect(
      await screen.findByText("Error signing in. Please try again."),
    ).toBeInTheDocument()
  })

  it("preserves the claim destination when switching to signup", async () => {
    searchParamsMap = { offer: "yc_2026", next: "/yc/claim" }
    render(<SignInPage />)
    const link = await screen.findByRole("link", { name: "Create an account" })
    const url = new URL(
      link.getAttribute("href")!,
      "https://console.example.test",
    )
    expect(url.searchParams.get("next")).toBe("/yc/claim")
    expect(url.searchParams.get("offer")).toBe("yc_2026")
    expect(link).not.toHaveClass("ph-no-capture")
  })

  it("keeps an invite destination in the signup link out of session replay", async () => {
    searchParamsMap = { next: "/invite/ssinv_exampletoken" }
    render(<SignInPage />)
    const link = await screen.findByRole("link", { name: "Create an account" })
    expect(
      new URL(
        link.getAttribute("href")!,
        "https://console.example.test",
      ).searchParams.get("next"),
    ).toBe("/invite/ssinv_exampletoken")
    expect(link).toHaveClass("ph-no-capture")
  })

  it("carries the offer through the signup link and Google signin", async () => {
    searchParamsMap = { offer: "pro_annual" }
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    render(<SignInPage />)
    expect(
      await screen.findByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/auth/signup?offer=pro_annual")
    await user.click(
      screen.getByRole("button", { name: /Continue with Google/ }),
    )
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled())
    expect(
      new URL(
        mockSignInWithOAuth.mock.lastCall![0].options.redirectTo,
      ).searchParams.get("offer"),
    ).toBe("pro_annual")
  })

  it("triggers Google OAuth on button click", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    render(<SignInPage />)

    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: {
          queryParams: { prompt: "select_account" },
          redirectTo: expect.stringContaining(
            "google_signin_intent=signin-origin",
          ),
        },
      })
    })
  })

  it("forwards the retained staff review claim into the normal Google callback", async () => {
    const next = "/admin/yc?claim=11111111-1111-4111-8111-111111111111"
    searchParamsMap = { next }
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    render(<SignInPage />)
    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled())
    const callback = new URL(
      mockSignInWithOAuth.mock.lastCall![0].options.redirectTo,
    )
    expect(callback.pathname).toBe("/auth/callback")
    expect(callback.searchParams.get("next")).toBe(next)
  })

  it("runs the sign-up check first so a new Google account needs one trip", async () => {
    mockGoogleSignupAttempt.mockResolvedValue("attempt-123")
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    render(<SignInPage />)
    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1))
    expect(mockGoogleSignupAttempt).toHaveBeenCalledTimes(1)
    // Next.js runs server actions one at a time: the short origin action
    // goes first, so a stalled check cannot hold it back.
    expect(mockBeginGoogleSignIn.mock.invocationCallOrder[0]).toBeLessThan(
      mockGoogleSignupAttempt.mock.invocationCallOrder[0],
    )
    const { options } = mockSignInWithOAuth.mock.calls[0][0]
    const callback = new URL(options.redirectTo)
    expect(callback.searchParams.get("signup_attempt_id")).toBe("attempt-123")
    expect(callback.searchParams.get("google_signin_intent")).toBe(
      "signin-origin",
    )
    // Sign-in still lets the user pick an account on the first trip.
    expect(options.queryParams).toEqual({ prompt: "select_account" })
    expect(mockClearFingerprintCapture).toHaveBeenCalledTimes(1)
  })

  it("prepares the sign-up check when the page loads, before any click", async () => {
    render(<SignInPage />)
    await screen.findByRole("button", { name: /Continue with Google/ })
    expect(mockPrefetchGoogleSignupCheck).toHaveBeenCalled()
    expect(mockGoogleSignupAttempt).not.toHaveBeenCalled()
  })

  it("continues Google sign-in without a sign-up attempt when the check fails", async () => {
    mockGoogleSignupAttempt.mockResolvedValue(undefined)
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    render(<SignInPage />)
    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1))
    const callback = new URL(
      mockSignInWithOAuth.mock.calls[0][0].options.redirectTo,
    )
    expect(callback.searchParams.has("signup_attempt_id")).toBe(false)
    // A failed check must not leave capture state for a later sign-up.
    expect(mockClearFingerprintCapture).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Error signing in/)).not.toBeInTheDocument()
  })

  it("keeps the fingerprint capture when Google OAuth does not start", async () => {
    mockGoogleSignupAttempt.mockResolvedValue("attempt-123")
    mockSignInWithOAuth.mockResolvedValue({ error: new Error("oauth down") })
    render(<SignInPage />)
    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )
    expect(await screen.findByText(/Error signing in/)).toBeInTheDocument()
    expect(mockClearFingerprintCapture).not.toHaveBeenCalled()
  })

  it("waits for the sign-up check before it unlocks after an origin failure", async () => {
    let finishCheck: (value: string | undefined) => void = () => {}
    mockGoogleSignupAttempt.mockReturnValue(
      new Promise((resolve) => {
        finishCheck = resolve
      }),
    )
    mockBeginGoogleSignIn.mockRejectedValue(new Error("network"))
    render(<SignInPage />)
    const button = await screen.findByRole("button", {
      name: /Continue with Google/,
    })
    await user.click(button)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText(/Error signing in/)).not.toBeInTheDocument()
    expect(button).toBeDisabled()
    finishCheck("attempt-123")
    expect(await screen.findByText(/Error signing in/)).toBeInTheDocument()
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
    expect(mockClearFingerprintCapture).not.toHaveBeenCalled()
  })

  it("continues Google sign-in when optional origin retention is unavailable", async () => {
    mockBeginGoogleSignIn.mockResolvedValue(undefined)
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    render(<SignInPage />)
    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled())
    expect(
      mockSignInWithOAuth.mock.calls[0][0].options.redirectTo,
    ).not.toContain("google_signin_intent")
  })

  it("has links to create an account and forgot password", async () => {
    render(<SignInPage />)

    expect(
      await screen.findByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/auth/signup")
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/auth/forgot-password")
  })

  it("redirects if user already has a valid session", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "123" } },
      error: null,
    })

    render(<SignInPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/")
    })
  })

  it("does not sign out on transient errors in the session check", async () => {
    // Simulate a network blip — should leave the session alone.
    mockGetUser.mockRejectedValue(new Error("network"))
    render(<SignInPage />)

    await waitFor(() => {
      // Form is still rendered
      expect(
        screen.getByRole("button", { name: "Sign In" }),
      ).toBeInTheDocument()
    })
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  describe("sign-in recovery", () => {
    const failPasswordSignIn = async (email = "test@test.com") => {
      mockSignInWithPassword.mockResolvedValue({
        error: { message: "Invalid login credentials" },
      })
      render(<SignInPage />)
      await user.type(await screen.findByPlaceholderText("Email"), email)
      await user.type(screen.getByPlaceholderText("Password"), "wrongpassword")
      await user.click(screen.getByRole("button", { name: "Sign In" }))
      return screen.findByRole("region", { name: "Other ways to sign in" })
    }

    it("is hidden until a password sign-in fails", async () => {
      render(<SignInPage />)
      await screen.findByPlaceholderText("Email")
      expect(
        screen.queryByRole("region", { name: "Other ways to sign in" }),
      ).not.toBeInTheDocument()
    })

    it("offers a sign-in link, Google, and password reset after invalid credentials", async () => {
      const region = await failPasswordSignIn()

      expect(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      ).toBeInTheDocument()
      expect(
        within(region).getByRole("button", { name: /Continue with Google/ }),
      ).toBeInTheDocument()
      expect(
        within(region).getByRole("link", { name: "Forgot password?" }),
      ).toHaveAttribute("href", "/auth/forgot-password")
      expect(mockCapture).toHaveBeenCalledWith("auth_sign_in_recovery_shown", {
        method: "email",
      })
    })

    it("keeps the invite on the recovery Forgot password link", async () => {
      const next = `/invite/ssinv_use_${"T".repeat(43)}`
      searchParamsMap = { next }
      const region = await failPasswordSignIn()

      const link = within(region).getByRole("link", {
        name: "Forgot password?",
      })
      const url = new URL(
        link.getAttribute("href")!,
        "https://console.example.com",
      )
      expect(url.pathname).toBe("/auth/forgot-password")
      expect(url.searchParams.get("next")).toBe(next)
      expect(link).toHaveClass("ph-no-capture")
    })

    it("tracks the shown event once per page view", async () => {
      await failPasswordSignIn()
      await user.click(screen.getByRole("button", { name: "Sign In" }))
      await waitFor(() =>
        expect(mockSignInWithPassword).toHaveBeenCalledTimes(2),
      )
      expect(
        mockCapture.mock.calls.filter(
          ([event]) => event === "auth_sign_in_recovery_shown",
        ),
      ).toHaveLength(1)
    })

    it("does not offer recovery for other sign-in errors", async () => {
      mockSignInWithPassword.mockResolvedValue({
        error: { message: "Email not confirmed" },
      })
      render(<SignInPage />)
      await user.type(
        await screen.findByPlaceholderText("Email"),
        "test@test.com",
      )
      await user.type(screen.getByPlaceholderText("Password"), "password123")
      await user.click(screen.getByRole("button", { name: "Sign In" }))
      await screen.findByText("Please verify your email before signing in.")
      expect(
        screen.queryByRole("region", { name: "Other ways to sign in" }),
      ).not.toBeInTheDocument()
    })

    it("requests a sign-in link and shows the neutral confirmation", async () => {
      searchParamsMap = { next: "/sandboxes" }
      const region = await failPasswordSignIn("someone@example.com")

      await user.click(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      )

      expect(
        await within(region).findByText(
          /If an account exists, we sent a link to/,
        ),
      ).toHaveTextContent(
        "If an account exists, we sent a link to someone@example.com.",
      )
      // Session replay must not record the typed address.
      expect(within(region).getByText("someone@example.com")).toHaveAttribute(
        "data-mask",
      )
      expect(mockSendSignInLink).toHaveBeenCalledWith(
        "someone@example.com",
        undefined,
        "/sandboxes",
      )
      expect(mockCapture).toHaveBeenCalledWith(
        "auth_sign_in_recovery_option_clicked",
        { option: "magic_link" },
      )
      expect(mockCapture).toHaveBeenCalledWith("auth_sign_in_link_requested", {
        method: "email_link",
      })
      // Google and password reset stay available after the link is sent.
      expect(
        within(region).getByRole("button", { name: /Continue with Google/ }),
      ).toBeInTheDocument()
      expect(
        within(region).getByRole("link", { name: "Forgot password?" }),
      ).toBeInTheDocument()
    })

    it("sends the offer destination when there is no explicit next", async () => {
      searchParamsMap = { offer: "pro_monthly" }
      const region = await failPasswordSignIn("someone@example.com")

      await user.click(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      )

      await waitFor(() =>
        expect(mockSendSignInLink).toHaveBeenCalledWith(
          "someone@example.com",
          undefined,
          "/billing/pro/",
        ),
      )
    })

    it("shows an error and tracks the failure when the captcha check fails", async () => {
      mockSendSignInLink.mockResolvedValue({
        success: false,
        errorCode: "captcha_failed",
      })
      const region = await failPasswordSignIn()

      await user.click(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      )

      expect(
        await within(region).findByText(
          "We couldn't verify you're human. Please try again.",
        ),
      ).toBeInTheDocument()
      expect(mockCapture).toHaveBeenCalledWith("auth_sign_in_link_failed", {
        method: "email_link",
        reason: "captcha_failed",
      })
      expect(
        within(region).queryByText(/If an account exists/),
      ).not.toBeInTheDocument()
    })

    it("shows a retry error when the captcha provider is unavailable", async () => {
      mockSendSignInLink.mockResolvedValue({
        success: false,
        errorCode: "captcha_unavailable",
      })
      const region = await failPasswordSignIn()

      await user.click(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      )

      expect(
        await within(region).findByText(
          "Could not send the link. Please try again.",
        ),
      ).toBeInTheDocument()
      expect(mockCapture).toHaveBeenCalledWith("auth_sign_in_link_failed", {
        method: "email_link",
        reason: "captcha_unavailable",
      })
    })

    it("locks the email field while a link request is pending", async () => {
      let resolveRequest!: (value: { success: true }) => void
      mockSendSignInLink.mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
      )
      const region = await failPasswordSignIn("someone@example.com")

      await user.click(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      )

      const emailInput = screen.getByPlaceholderText("Email")
      await waitFor(() => expect(emailInput).toBeDisabled())
      resolveRequest({ success: true })
      await within(region).findByText(/If an account exists/)
      expect(emailInput).toBeEnabled()

      // Editing the address afterwards offers the link again.
      await user.type(emailInput, "x")
      expect(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      ).toBeInTheDocument()
    })

    it("tracks a request error", async () => {
      mockSendSignInLink.mockRejectedValue(new Error("network"))
      const region = await failPasswordSignIn()

      await user.click(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      )

      expect(
        await within(region).findByText(
          "Could not send the link. Please try again.",
        ),
      ).toBeInTheDocument()
      expect(mockCapture).toHaveBeenCalledWith("auth_sign_in_link_failed", {
        method: "email_link",
        reason: "request_error",
      })
    })

    it("marks Google sign-in from the recovery block in the callback URL", async () => {
      mockSignInWithOAuth.mockResolvedValue({ error: null })
      const region = await failPasswordSignIn()

      await user.click(
        within(region).getByRole("button", { name: /Continue with Google/ }),
      )

      await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled())
      const callbackUrl = new URL(
        mockSignInWithOAuth.mock.lastCall![0].options.redirectTo,
      )
      expect(callbackUrl.pathname).toBe("/auth/callback")
      expect(callbackUrl.searchParams.get("sign_in_recovery")).toBe("google")
      expect(callbackUrl.searchParams.get("google_signin_intent")).toBe(
        "signin-origin",
      )
      expect(mockCapture).toHaveBeenCalledWith(
        "auth_sign_in_recovery_option_clicked",
        { option: "google" },
      )
    })

    it("does not mark the main Google button as recovery", async () => {
      mockSignInWithOAuth.mockResolvedValue({ error: null })
      render(<SignInPage />)

      await user.click(
        await screen.findByRole("button", { name: /Continue with Google/ }),
      )

      await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled())
      expect(
        new URL(
          mockSignInWithOAuth.mock.lastCall![0].options.redirectTo,
        ).searchParams.has("sign_in_recovery"),
      ).toBe(false)
    })

    it("tracks the forgot-password option", async () => {
      const region = await failPasswordSignIn()

      await user.click(
        within(region).getByRole("link", { name: "Forgot password?" }),
      )

      expect(mockCapture).toHaveBeenCalledWith(
        "auth_sign_in_recovery_option_clicked",
        { option: "forgot_password" },
      )
    })
  })
})
