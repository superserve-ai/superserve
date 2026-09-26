import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SIGNUP_RESTRICTED_MESSAGE } from "@/lib/auth/signup-restricted-message"

let reason: string | null = null
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(reason ? { reason } : {}),
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
  Button: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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
  })

  it("displays the shared signup restriction message for callback denials", () => {
    reason = "signup_blocked"
    render(<AuthCodeErrorPage />)
    expect(screen.getByText(SIGNUP_RESTRICTED_MESSAGE)).toBeTruthy()
    expect(
      screen.queryByText("Something went wrong. Please try again."),
    ).toBeNull()
  })

  it("preserves the ordinary authentication error message", () => {
    render(<AuthCodeErrorPage />)
    expect(
      screen.getByText("Something went wrong. Please try again."),
    ).toBeTruthy()
  })
})
