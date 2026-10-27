import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SIGNUP_RESTRICTED_MESSAGE } from "@/lib/auth/signup-restricted-message"

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signOut } }),
}))
let reason: string | null = null
let intent: string | null = null
let next: string | null = null
let account: string | null = null
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams({
      ...(reason ? { reason } : {}),
      ...(intent ? { signup_offer: intent } : {}),
      ...(next ? { next } : {}),
      ...(account ? { account } : {}),
    }),
}))
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
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
vi.mock("@superserve/ui", () => ({
  Button: ({
    render,
    children,
    ...props
  }: React.ComponentProps<"button"> & { render?: React.ReactElement }) =>
    render ? (
      <a href={(render.props as { href: string }).href}>{children}</a>
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

  it.each([
    "/plan-usage/buy-credit/",
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
    next = "/plan-usage/buy-credit/"
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
