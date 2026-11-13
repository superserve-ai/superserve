import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SIGNUP_RESTRICTED_MESSAGE } from "@/lib/auth/signup-restricted-message"

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signOut } }),
}))
let reason: string | null = null
let intent: string | null = null
let next: string | null = null
let account: string | null = null
let errorCode: string | null = null
let type: string | null = null
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams({
      ...(reason ? { reason } : {}),
      ...(intent ? { signup_offer: intent } : {}),
      ...(next ? { next } : {}),
      ...(account ? { account } : {}),
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(type ? { type } : {}),
    }),
}))
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
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
vi.mock("@superserve/ui", () => ({
  cn: (...classes: (string | undefined)[]) => classes.filter(Boolean).join(" "),
  Button: ({
    render,
    children,
    ...props
  }: React.ComponentProps<"button"> & { render?: React.ReactElement }) =>
    render ? (
      <a
        href={(render.props as { href: string }).href}
        className={props.className}
      >
        {children}
      </a>
    ) : (
      <button {...props}>{children}</button>
    ),
}))
vi.mock("@phosphor-icons/react", () => ({ WarningIcon: () => null }))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))

import AuthCodeErrorPage from "./page"

describe("auth-code-error page", () => {
  beforeEach(() => {
    signOut.mockReset().mockResolvedValue({ error: null })
    reason = null
    intent = null
    next = null
    account = null
    errorCode = null
    type = null
    window.location.hash = ""
  })

  afterEach(() => {
    window.location.hash = ""
  })

  it("offers a new password reset link when the query reports an expired recovery link", () => {
    errorCode = "otp_expired"
    type = "recovery"
    render(<AuthCodeErrorPage />)

    expect(
      screen.getByRole("heading", { name: "Reset link expired" }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        "This password reset link expired or was already used. Request a new link to reset your password.",
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Request a new reset link" }),
    ).toHaveAttribute("href", "/auth/forgot-password")
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/auth/signin")
    expect(
      screen.queryByRole("link", { name: "Get a new confirmation link" }),
    ).toBeNull()
    expect(screen.queryByRole("link", { name: "Try Again" })).toBeNull()
  })

  it("offers both new-link paths when only the fragment reports an expired link", () => {
    window.location.hash =
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
    render(<AuthCodeErrorPage />)

    expect(screen.getByRole("heading", { name: "Link expired" })).toBeTruthy()
    expect(
      screen.getByText(
        "This link expired or was already used. To reset your password, request a new reset link. To confirm a new account, sign up again with the same email and password to get a new confirmation link.",
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Request a new reset link" }),
    ).toHaveAttribute("href", "/auth/forgot-password")
    expect(
      screen.getByRole("link", { name: "Get a new confirmation link" }),
    ).toHaveAttribute("href", "/auth/signup?error=link_expired")
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/auth/signin")
    expect(screen.queryByRole("link", { name: "Try Again" })).toBeNull()
  })

  it("uses recovery copy when the fragment reports expiry and the query identifies recovery", () => {
    window.location.hash = "#error_code=otp_expired"
    type = "recovery"
    render(<AuthCodeErrorPage />)

    expect(
      screen.getByRole("heading", { name: "Reset link expired" }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        "This password reset link expired or was already used. Request a new link to reset your password.",
      ),
    ).toBeTruthy()
    expect(
      screen.queryByRole("link", { name: "Get a new confirmation link" }),
    ).toBeNull()
  })

  it("updates the expired-link view when the fragment changes", () => {
    render(<AuthCodeErrorPage />)
    expect(
      screen.getByRole("heading", { name: "Authentication Error" }),
    ).toBeTruthy()

    window.location.hash = "#error_code=otp_expired"
    fireEvent(window, new HashChangeEvent("hashchange"))

    expect(screen.getByRole("heading", { name: "Link expired" })).toBeTruthy()
  })

  it.each(["query", "fragment"])(
    "preserves the generic error for a non-expired %s error code",
    (source) => {
      type = "recovery"
      if (source === "query") errorCode = "unexpected_failure"
      else window.location.hash = "#error_code=bad_oauth_state"
      render(<AuthCodeErrorPage />)

      expect(
        screen.getByRole("heading", { name: "Authentication Error" }),
      ).toBeTruthy()
      expect(
        screen.getByText("Something went wrong. Please try again."),
      ).toBeTruthy()
      expect(screen.getByRole("link", { name: "Try Again" })).toHaveAttribute(
        "href",
        "/auth/signin",
      )
      expect(
        screen.queryByRole("link", { name: "Request a new reset link" }),
      ).toBeNull()
    },
  )

  it.each([
    ["signup_blocked", SIGNUP_RESTRICTED_MESSAGE],
    [
      "account_changed",
      "Sign in to the account that started checkout to continue with your selected plan.",
    ],
    ["pricing_unavailable", "Something went wrong. Please try again."],
  ])("keeps the %s reason ahead of link expiry", (blocked, message) => {
    reason = blocked
    account = "original-owner"
    next = "/billing-usage/buy-credit/"
    errorCode = "otp_expired"
    type = "recovery"
    window.location.hash = "#error_code=otp_expired"
    render(<AuthCodeErrorPage />)

    expect(
      screen.getByRole("heading", { name: "Authentication Error" }),
    ).toBeTruthy()
    expect(screen.getByText(message)).toBeTruthy()
    expect(
      screen.queryByRole("link", { name: "Request a new reset link" }),
    ).toBeNull()
  })

  it("keeps an invitation on expired-link signup and sign-in links but Enterprise intent only on sign-in", () => {
    const invite = `/invite/ssinv_use_${"A".repeat(43)}`
    next = invite
    intent = "enterprise"
    errorCode = "otp_expired"
    type = "magiclink"
    render(<AuthCodeErrorPage />)

    expect(screen.getByRole("heading", { name: "Link expired" })).toBeTruthy()
    const confirmation = screen.getByRole("link", {
      name: "Get a new confirmation link",
    })
    expect(confirmation).toHaveAttribute(
      "href",
      `/auth/signup?${new URLSearchParams({ error: "link_expired", next: invite })}`,
    )
    expect(confirmation).toHaveClass("ph-no-capture")
    const signin = screen.getByRole("link", { name: "Back to sign in" })
    expect(signin).toHaveAttribute(
      "href",
      `/auth/signin?${new URLSearchParams({ signup_offer: "enterprise", next: invite })}`,
    )
    expect(signin).toHaveClass("ph-no-capture")
  })

  it("displays the shared signup restriction message for callback denials", () => {
    reason = "signup_blocked"
    render(<AuthCodeErrorPage />)
    expect(screen.getByText(SIGNUP_RESTRICTED_MESSAGE)).toBeTruthy()
    expect(
      screen.queryByText("Something went wrong. Please try again."),
    ).toBeNull()
  })

  it("keeps Enterprise intent on the actual retry link", () => {
    reason = "pricing_unavailable"
    intent = "enterprise"
    render(<AuthCodeErrorPage />)
    expect(
      screen.getByRole("link", { name: "Try Again" }).getAttribute("href"),
    ).toBe("/auth/signin?signup_offer=enterprise")
  })

  it("drops unrecognized retry intent", () => {
    intent = "https://evil.example"
    render(<AuthCodeErrorPage />)
    expect(
      screen.getByRole("link", { name: "Try Again" }).getAttribute("href"),
    ).toBe("/auth/signin")
  })

  it("keeps an invitation destination on the retry link", () => {
    const invite = `/invite/ssinv_use_${"A".repeat(43)}`
    reason = "membership_lookup_degraded"
    next = invite
    render(<AuthCodeErrorPage />)
    const retry = screen.getByRole("link", { name: "Try Again" })
    expect(retry.getAttribute("href")).toBe(
      `/auth/signin?${new URLSearchParams({ next: invite })}`,
    )
    expect(retry).toHaveClass("ph-no-capture")
  })

  it("drops an invitation destination that is not a bare invite path", () => {
    reason = "membership_lookup_degraded"
    next = `/invite/ssinv_use_${"A".repeat(43)}/extra`
    render(<AuthCodeErrorPage />)
    const retry = screen.getByRole("link", { name: "Try Again" })
    expect(retry.getAttribute("href")).toBe("/auth/signin")
    expect(retry).not.toHaveClass("ph-no-capture")
  })

  it.each([
    "/billing-usage/buy-credit/",
    "/billing/pro/?team=use%3Aoriginal&billing=success",
  ])(
    "retries account setup with the bound paid destination %s",
    (destination) => {
      reason = "account_setup"
      next = destination
      account = "owner"
      render(<AuthCodeErrorPage />)
      const href = new URL(
        screen.getByRole("link", { name: "Try Again" }).getAttribute("href")!,
        "https://console.test",
      )
      expect(href.pathname).toBe("/api/onboarding/prepare/")
      expect(href.searchParams.get("account")).toBe("owner")
      expect(href.searchParams.get("next")).toBe(destination)
    },
  )

  it.each(["https://evil.test", "//evil.test", "/billing/pro?approved=true"])(
    "drops unsafe account setup continuation %s",
    (destination) => {
      reason = "account_setup"
      next = destination
      account = "owner"
      render(<AuthCodeErrorPage />)
      expect(
        screen.getByRole("link", { name: "Try Again" }).getAttribute("href"),
      ).toBe("/auth/signin")
    },
  )

  it("signs out locally and retains the original account and paid path when switching accounts", async () => {
    reason = "account_changed"
    account = "original-owner"
    next = "/billing/pro/?team=use%3Aoriginal&billing=success"
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {})
    render(<AuthCodeErrorPage />)
    expect(
      screen.getByText(/Sign in to the account that started checkout/),
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Try Again" })).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out and use another account" }),
    )
    await waitFor(() => expect(assign).toHaveBeenCalledOnce())
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
    const signin = new URL(assign.mock.lastCall![0], "https://console.test")
    expect(signin.pathname).toBe("/auth/signin")
    const preparation = new URL(signin.searchParams.get("next")!, signin)
    expect(preparation.pathname).toBe("/api/onboarding/prepare/")
    expect(preparation.searchParams.get("account")).toBe("original-owner")
    expect(preparation.searchParams.get("next")).toBe(next)
    assign.mockRestore()
  })

  it("does not navigate or lose the saved destination when local sign-out fails", async () => {
    reason = "account_changed"
    account = "original-owner"
    next = "/billing-usage/buy-credit/"
    signOut.mockResolvedValue({ error: new Error("unavailable") })
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {})
    render(<AuthCodeErrorPage />)
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out and use another account" }),
    )
    await screen.findByRole("alert")
    expect(assign).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Sign out and use another account" }),
    ).toBeEnabled()
    assign.mockRestore()
  })

  it.each([
    [
      "impersonation",
      "Return to console to end impersonation",
      "Continue after ending impersonation",
    ],
    [
      "team_changed",
      "Return to console to select the original team",
      "Continue after selecting the original team",
    ],
  ])(
    "provides an actionable %s recovery without changing saved account/team",
    (blocked, consoleLabel, continueLabel) => {
      reason = blocked
      account = "original-owner"
      next = "/billing/pro/?team=use%3Aoriginal&billing=success"
      render(<AuthCodeErrorPage />)
      expect(
        screen.getByRole("link", { name: consoleLabel }).getAttribute("href"),
      ).toBe("/sandboxes")
      const continuation = new URL(
        screen.getByRole("link", { name: continueLabel }).getAttribute("href")!,
        "https://console.test",
      )
      expect(continuation.searchParams.get("account")).toBe("original-owner")
      expect(continuation.searchParams.get("next")).toBe(next)
      expect(screen.queryByRole("link", { name: "Try Again" })).toBeNull()
      expect(signOut).not.toHaveBeenCalled()
    },
  )

  it("does not choose a team or offer retry when saved checkout locators contradict", () => {
    reason = "team_conflict"
    account = "original-owner"
    next = "/billing/pro/?team=use%3Aoriginal"
    render(<AuthCodeErrorPage />)
    expect(
      screen.getByText(/Saved checkout team details conflict/),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Return to console" })
        .getAttribute("href"),
    ).toBe("/sandboxes")
    expect(
      screen.queryByRole("link", { name: /Continue|Try Again/ }),
    ).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })

  it("does not offer account switching for an unsafe or unbound recovery URL", () => {
    reason = "account_changed"
    account = "original-owner"
    next = "https://evil.test"
    render(<AuthCodeErrorPage />)
    expect(
      screen.queryByRole("button", {
        name: "Sign out and use another account",
      }),
    ).toBeNull()
    expect(
      screen.getByRole("link", { name: "Try Again" }).getAttribute("href"),
    ).toBe("/auth/signin")
  })

  it("preserves the ordinary authentication error message", () => {
    render(<AuthCodeErrorPage />)
    expect(
      screen.getByText("Something went wrong. Please try again."),
    ).toBeTruthy()
  })
})
