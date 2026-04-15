import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks ---

// @superserve/ui — mock only the pieces the page uses. Input renders its
// `error` prop visibly (like the real component), so assertions can search
// by text instead of needing aria lookups.
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

const mockPush = vi.fn()
let searchParamsMap: Record<string, string> = {}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsMap[key] ?? null,
  }),
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

const mockCapture = vi.fn()
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

const mockSignInWithPassword = vi.fn()
const mockSignInWithOAuth = vi.fn()
const mockGetUser = vi.fn()
const mockSignOut = vi.fn()

vi.mock("@superserve/supabase", () => ({
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

  beforeEach(() => {
    mockPush.mockReset()
    mockSignInWithPassword.mockReset()
    mockSignInWithOAuth.mockReset()
    mockSignOut.mockReset()
    mockCapture.mockReset()
    searchParamsMap = {}
    // Default: no existing session
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })
  })

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
      expect(mockPush).toHaveBeenCalledWith("/")
    })
  })

  it("redirects to next URL after successful login", async () => {
    searchParamsMap = { next: "/sandboxes" }
    mockSignInWithPassword.mockResolvedValue({ error: null })
    render(<SignInPage />)

    await user.type(
      await screen.findByPlaceholderText("Email"),
      "test@test.com",
    )
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Sign In" }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/sandboxes")
    })
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

  it("triggers Google OAuth on button click", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    render(<SignInPage />)

    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: expect.stringContaining("/auth/callback") },
      })
    })
  })

  it("has links to sign up and forgot password", async () => {
    render(<SignInPage />)

    expect(
      await screen.findByRole("link", { name: "Sign up" }),
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
      expect(mockPush).toHaveBeenCalledWith("/")
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
})
