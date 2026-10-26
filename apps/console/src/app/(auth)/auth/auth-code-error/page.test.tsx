import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SIGNUP_RESTRICTED_MESSAGE } from "@/lib/auth/signup-restricted-message"

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
  }: {
    render: React.ReactElement
    children: React.ReactNode
  }) => <a href={(render.props as { href: string }).href}>{children}</a>,
}))
vi.mock("@phosphor-icons/react", () => ({ WarningIcon: () => null }))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))

import AuthCodeErrorPage from "./page"

describe("auth-code-error page", () => {
  beforeEach(() => {
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

  it("preserves the ordinary authentication error message", () => {
    render(<AuthCodeErrorPage />)
    expect(
      screen.getByText("Something went wrong. Please try again."),
    ).toBeTruthy()
  })
})
