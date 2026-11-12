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

const recaptcha = vi.hoisted(() => ({
  siteKey: undefined as string | undefined,
  getToken: vi.fn(),
}))
vi.mock("@/lib/recaptcha/client", () => ({
  get RECAPTCHA_SITE_KEY() {
    return recaptcha.siteKey
  },
  getRecaptchaToken: (...args: unknown[]) => recaptcha.getToken(...args),
}))

const mockSignInWithPassword = vi.fn()
const mockSignInWithOAuth = vi.fn()
const mockGetUser = vi.fn()
const mockSignOut = vi.fn()
const mockBeginGoogleSignIn = vi.fn()
vi.mock("./google-action", () => ({
  beginGoogleSignIn: () => mockBeginGoogleSignIn(),
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
    mockCapture.mockReset()
    mockSendSignInLink.mockReset().mockResolvedValue({ success: true })
    recaptcha.siteKey = undefined
    recaptcha.getToken.mockReset().mockResolvedValue(undefined)
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

  it("toggles password visibility with a larger hit area", async () => {
    render(<SignInPage />)

    const password = await screen.findByPlaceholderText("Password")
    const toggle = screen.getByRole("button", { name: "Show password" })
    expect(toggle).toHaveClass("-m-1", "p-1")
    expect(toggle).toHaveAttribute("aria-pressed", "false")
    expect(password).toHaveAttribute("type", "password")

    await user.click(toggle)

    expect(screen.getByRole("button", { name: "Hide password" })).toBe(toggle)
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    expect(password).toHaveAttribute("type", "text")

    await user.click(toggle)

    expect(screen.getByRole("button", { name: "Show password" })).toBe(toggle)
    expect(toggle).toHaveAttribute("aria-pressed", "false")
    expect(password).toHaveAttribute("type", "password")
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
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Unexpected auth error" },
    })
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    expect(
      await screen.findByText(
        "We couldn't sign you in. Try again, or continue with Google.",
      ),
    ).toBeInTheDocument()
  })

  it("offers Google after a generic error without showing recovery on a fresh page", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: {
        name: "AuthRetryableFetchError",
        status: 503,
        message: "Service Unavailable",
      },
    })
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    expect(
      await screen.findByText(
        "We couldn't sign you in. Try again, or continue with Google.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: "Other ways to sign in" }),
    ).not.toBeInTheDocument()
  })

  it.each([
    {
      cause: "a rejected fetch returned by Supabase",
      error: {
        name: "AuthRetryableFetchError",
        status: 0,
        message: "Failed to fetch",
      },
      copy: "We couldn't reach Superserve. Check your connection and try again.",
    },
    {
      cause: "a banned user",
      error: { message: "User is banned", code: "user_banned", status: 400 },
      copy: "Error signing in. Please try again.",
    },
    {
      cause: "a ban code before a network message",
      error: { message: "Failed to fetch", code: "user_banned", status: 400 },
      copy: "Error signing in. Please try again.",
    },
    {
      cause: "a ban message without a code",
      error: { message: "User is banned", status: 400 },
      copy: "Error signing in. Please try again.",
    },
    {
      cause: "a retryable gateway error",
      error: {
        name: "AuthRetryableFetchError",
        status: 503,
        message: "Service Unavailable",
      },
      copy: "We couldn't sign you in. Try again, or continue with Google.",
    },
    {
      cause: "an unparseable response",
      error: {
        name: "AuthRetryableFetchError",
        status: 0,
        message: "Unexpected token '<', \"<html>\" is not valid JSON",
      },
      copy: "We couldn't sign you in. Try again, or continue with Google.",
    },
  ])(
    "shows the expected copy for $cause and tracks the reason",
    async ({ error, copy }) => {
      mockSignInWithPassword.mockResolvedValue({ error })
      render(<SignInPage />)

      await user.type(
        await screen.findByPlaceholderText("Email"),
        "test@test.com",
      )
      await user.type(screen.getByPlaceholderText("Password"), "password123")
      await user.click(screen.getByRole("button", { name: "Sign In" }))

      expect(await screen.findByText(copy)).toBeInTheDocument()
      expect(mockCapture).toHaveBeenCalledWith("auth_sign_in_failed", {
        method: "email",
        reason: error.message,
      })
      if (error.status === 503) {
        expect(
          screen.queryByText(
            "We couldn't reach Superserve. Check your connection and try again.",
          ),
        ).not.toBeInTheDocument()
      }
    },
  )

  it.each([
    {
      error: new TypeError("Failed to fetch"),
      copy: "We couldn't reach Superserve. Check your connection and try again.",
    },
    {
      error: new Error("boom"),
      copy: "We couldn't sign you in. Try again, or continue with Google.",
    },
  ])(
    "shows the expected copy when password sign-in throws $error",
    async ({ error, copy }) => {
      mockSignInWithPassword.mockRejectedValue(error)
      render(<SignInPage />)

      await user.type(
        await screen.findByPlaceholderText("Email"),
        "test@test.com",
      )
      await user.type(screen.getByPlaceholderText("Password"), "password123")
      await user.click(screen.getByRole("button", { name: "Sign In" }))

      expect(await screen.findByText(copy)).toBeInTheDocument()
    },
  )

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

  it("shows a Google sign-in error when OAuth returns an error", async () => {
    mockSignInWithOAuth.mockResolvedValue({
      error: { message: "OAuth provider unavailable" },
    })
    render(<SignInPage />)

    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )

    expect(
      await screen.findByText(
        "We couldn't start Google sign-in. Try again, or sign in with email.",
      ),
    ).toBeInTheDocument()
  })

  it.each(["beginGoogleSignIn", "signInWithOAuth"])(
    "shows a Google sign-in error when %s throws",
    async (source) => {
      const mock =
        source === "beginGoogleSignIn"
          ? mockBeginGoogleSignIn
          : mockSignInWithOAuth
      mock.mockRejectedValue(new Error("Failed to fetch"))
      render(<SignInPage />)

      await user.click(
        await screen.findByRole("button", { name: /Continue with Google/ }),
      )

      expect(
        await screen.findByText(
          "We couldn't start Google sign-in. Try again, or sign in with email.",
        ),
      ).toBeInTheDocument()
    },
  )

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

    it("explains how to unblock the bot check when no token is available", async () => {
      recaptcha.siteKey = "site-key"
      const region = await failPasswordSignIn()

      await user.click(
        within(region).getByRole("button", { name: "Email me a sign-in link" }),
      )

      expect(
        await within(region).findByText(
          "Our bot check couldn't finish. Refresh the page and try again. If it still fails, turn off ad or content blockers for this site.",
        ),
      ).toBeInTheDocument()
      expect(recaptcha.getToken).toHaveBeenCalledWith("signin_link")
      expect(mockSendSignInLink).not.toHaveBeenCalled()
      expect(mockCapture).toHaveBeenCalledWith("auth_sign_in_link_failed", {
        method: "email_link",
        reason: "captcha_unavailable",
      })
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
          "We couldn't verify you're human. Refresh the page and try again.",
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
          "We couldn't send the sign-in link. Try again in a minute, or continue with Google.",
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
          "We couldn't send the sign-in link. Try again in a minute, or continue with Google.",
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
