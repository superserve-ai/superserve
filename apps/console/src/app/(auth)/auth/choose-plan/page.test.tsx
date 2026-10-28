import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

let params = new URLSearchParams()
vi.mock("next/navigation", () => ({ useSearchParams: () => params }))
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
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))

import ChoosePlanPage from "./page"

describe("plan picker", () => {
  beforeEach(() => {
    params = new URLSearchParams()
  })

  it("offers both plans when the trial has ended", () => {
    params = new URLSearchParams({
      reason: "trial_ended",
      offer: "developer",
      account: "u1",
      team: "use:team-1",
    })
    render(<ChoosePlanPage />)
    expect(
      screen
        .getByRole("button", { name: "Developer" })
        .closest("form")!
        .getAttribute("action"),
    ).toBe(
      "/api/onboarding/checkout/?offer=developer&account=u1&team=use%3Ateam-1",
    )
    expect(screen.getByRole("button", { name: "Pro" })).toBeTruthy()
  })

  it.each(["payment_confirming", "checkout_elsewhere"])(
    "only re-checks the original checkout for %s",
    (reason) => {
      params = new URLSearchParams({
        reason,
        account: "u1",
        team: "use:team-1",
      })
      render(<ChoosePlanPage />)
      expect(screen.queryByRole("button", { name: "Developer" })).toBeNull()
      expect(screen.queryByRole("button", { name: "Pro" })).toBeNull()
      expect(
        screen.getByRole("link", { name: "Check again" }).getAttribute("href"),
      ).toBe("/api/onboarding/checkout/return/?account=u1&team=use%3Ateam-1")
    },
  )

  it("offers no purchase without the account and team it was shown for", () => {
    params = new URLSearchParams({ reason: "trial_ended", offer: "developer" })
    render(<ChoosePlanPage />)
    expect(screen.queryByRole("button", { name: "Developer" })).toBeNull()
    expect(screen.getByRole("link", { name: "Back to console" })).toBeTruthy()
  })

  it("offers no purchase when a checkout return names no checkout", () => {
    params = new URLSearchParams({ reason: "checkout_elsewhere" })
    render(<ChoosePlanPage />)
    expect(screen.queryByRole("button", { name: "Developer" })).toBeNull()
    expect(
      screen
        .getByRole("link", { name: "Back to console" })
        .getAttribute("href"),
    ).toBe("/sandboxes")
  })
})
