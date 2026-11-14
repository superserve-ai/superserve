import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CheckoutTeam } from "@/lib/billing/checkout-team-actions"
import { signupCheckoutReturnPath } from "@/lib/billing/signup-checkout-paths"

import { CheckoutElsewhere } from "./checkout-elsewhere"

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  setActiveTeam: vi.fn(),
  signOut: vi.fn(),
  assign: vi.fn(),
}))
vi.mock("@/lib/billing/checkout-team-actions", () => ({
  getCheckoutTeamAction: mocks.lookup,
}))
vi.mock("@/lib/api/teams-actions", () => ({
  setActiveTeamAction: mocks.setActiveTeam,
}))
vi.mock("@/hooks/use-sign-out", () => ({ useSignOut: () => mocks.signOut }))
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
  Spinner: () => <span role="progressbar" />,
}))

const locator = { account: "user", team: "use:team" }
const returnPath = signupCheckoutReturnPath(locator.account, locator.team)
const team = { id: "team", name: "Example team", region: "use" }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mocks.lookup.mockReset()
  mocks.setActiveTeam.mockReset().mockResolvedValue(undefined)
  mocks.signOut.mockReset().mockResolvedValue(undefined)
  mocks.assign.mockReset()
  vi.spyOn(window.location, "assign").mockImplementation(mocks.assign)
})

describe("CheckoutElsewhere", () => {
  it("shows only a spinner while teams load", () => {
    mocks.lookup.mockReturnValue(new Promise(() => {}))
    const { container } = render(<CheckoutElsewhere locator={locator} />)
    expect(
      container.querySelector(
        ".mt-5.h-5.w-5.animate-spin.border-2.border-primary.border-t-transparent",
      ),
    ).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith(locator)
  })

  it.each([
    [
      "switch",
      "This checkout is for Example team, but a different team is open now. Switch to Example team to continue.",
      "Switch to Example team",
      null,
    ],
    [
      "open",
      "The team that started this checkout is open now. Continue to check the payment.",
      "Continue",
      returnPath,
    ],
    [
      "other_account",
      "This checkout was started from a different account. Sign in with that account to continue.",
      "Sign out and switch account",
      null,
    ],
    [
      "signed_out",
      "Sign in to continue with this checkout.",
      "Sign in",
      `/auth/signin?next=${encodeURIComponent(returnPath)}`,
    ],
    [
      "not_member",
      "You're no longer a member of the team that started this checkout. Ask a team owner to invite you again, or continue in a team you belong to.",
      null,
      null,
    ],
  ] as const)("renders the %s recovery", async (kind, copy, label, href) => {
    mocks.lookup.mockResolvedValue(
      kind === "switch" ? { kind, team } : { kind },
    )
    render(<CheckoutElsewhere locator={locator} />)
    expect(await screen.findByText(copy)).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Back to console" }),
    ).toHaveAttribute("href", "/sandboxes")
    if (label) {
      const action = screen.getByRole(href ? "link" : "button", { name: label })
      if (href) expect(action).toHaveAttribute("href", href)
    } else {
      expect(screen.queryByRole("button")).toBeNull()
      expect(screen.getAllByRole("link")).toHaveLength(1)
    }
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith(locator)
    expect(mocks.setActiveTeam).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it("switches once before navigating once, even on double click", async () => {
    const switching = deferred<void>()
    mocks.lookup.mockResolvedValue({ kind: "switch", team })
    mocks.setActiveTeam.mockReturnValue(switching.promise)
    render(<CheckoutElsewhere locator={locator} />)
    const button = await screen.findByRole("button", {
      name: "Switch to Example team",
    })
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(mocks.setActiveTeam).toHaveBeenCalledExactlyOnceWith("team", "use")
    expect(mocks.assign).not.toHaveBeenCalled()
    expect(button).toBeDisabled()
    expect(screen.getByRole("progressbar")).toBeVisible()
    await act(async () => switching.resolve())
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith(returnPath)
    expect(mocks.setActiveTeam).toHaveBeenCalledTimes(1)
    fireEvent.click(button)
    expect(mocks.setActiveTeam).toHaveBeenCalledTimes(1)
    expect(mocks.lookup).toHaveBeenCalledTimes(1)
  })

  it("shows a switch failure and allows another attempt without navigating", async () => {
    mocks.lookup.mockResolvedValue({ kind: "switch", team })
    mocks.setActiveTeam.mockRejectedValue(new Error("Unavailable"))
    render(<CheckoutElsewhere locator={locator} />)
    const button = await screen.findByRole("button", {
      name: "Switch to Example team",
    })
    fireEvent.click(button)
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't switch teams. Try again.",
    )
    expect(button).toBeEnabled()
    expect(mocks.setActiveTeam).toHaveBeenCalledExactlyOnceWith("team", "use")
    expect(mocks.assign).not.toHaveBeenCalled()
    mocks.setActiveTeam.mockResolvedValue(undefined)
    fireEvent.click(button)
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledExactlyOnceWith(returnPath),
    )
    expect(mocks.setActiveTeam).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("signs out once with the original return path", async () => {
    const signingOut = deferred<void>()
    mocks.lookup.mockResolvedValue({ kind: "other_account" })
    mocks.signOut.mockReturnValue(signingOut.promise)
    render(<CheckoutElsewhere locator={locator} />)
    const button = await screen.findByRole("button", {
      name: "Sign out and switch account",
    })
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith(returnPath)
    expect(button).toBeDisabled()
    await act(async () => signingOut.resolve())
    fireEvent.click(button)
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.setActiveTeam).not.toHaveBeenCalled()
    expect(mocks.assign).not.toHaveBeenCalled()
  })

  it("shows a sign-out failure and re-enables the button without navigating", async () => {
    const signingOut = deferred<void>()
    mocks.lookup.mockResolvedValue({ kind: "other_account" })
    mocks.signOut.mockReturnValue(signingOut.promise)
    render(<CheckoutElsewhere locator={locator} />)
    const button = await screen.findByRole("button", {
      name: "Sign out and switch account",
    })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    await act(async () => signingOut.reject(new Error("Unavailable")))
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't sign you out. Try again.",
    )
    expect(button).toBeEnabled()
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith(returnPath)
    expect(mocks.assign).not.toHaveBeenCalled()
    mocks.signOut.mockReturnValue(new Promise(() => {}))
    fireEvent.click(button)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(button).toBeDisabled()
    expect(mocks.signOut).toHaveBeenCalledTimes(2)
    expect(mocks.assign).not.toHaveBeenCalled()
  })

  it("re-queries after a lookup error", async () => {
    mocks.lookup
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue({ kind: "open" })
    render(<CheckoutElsewhere locator={locator} />)
    expect(
      await screen.findByText("We couldn't load your teams."),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Back to console" })).toBeVisible()
    expect(mocks.lookup).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByRole("link", { name: "Continue" }),
    ).toHaveAttribute("href", returnPath)
    expect(mocks.lookup).toHaveBeenCalledTimes(2)
    expect(mocks.lookup).toHaveBeenNthCalledWith(2, locator)
  })

  it.each(["resolve", "reject"] as const)(
    "ignores a stale lookup %s from the previous locator",
    async (settle) => {
      const old = deferred<CheckoutTeam>()
      mocks.lookup
        .mockReturnValueOnce(old.promise)
        .mockResolvedValue({ kind: "open" })
      const view = render(<CheckoutElsewhere locator={locator} />)
      const next = { account: "other-user", team: "usw:other-team" }
      view.rerender(<CheckoutElsewhere locator={next} />)
      expect(
        await screen.findByRole("link", { name: "Continue" }),
      ).toHaveAttribute(
        "href",
        signupCheckoutReturnPath(next.account, next.team),
      )
      await act(async () => {
        if (settle === "resolve") old.resolve({ kind: "switch", team })
        else old.reject(new Error("Unavailable"))
      })
      expect(screen.queryByRole("button")).toBeNull()
      expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
        "href",
        signupCheckoutReturnPath(next.account, next.team),
      )
      expect(mocks.lookup).toHaveBeenCalledTimes(2)
      expect(mocks.lookup).toHaveBeenNthCalledWith(2, next)
    },
  )

  it("drops a completed lookup immediately when the locator changes", async () => {
    mocks.lookup
      .mockResolvedValueOnce({ kind: "switch", team })
      .mockReturnValue(new Promise(() => {}))
    const view = render(<CheckoutElsewhere locator={locator} />)
    await screen.findByRole("button", { name: "Switch to Example team" })
    view.rerender(
      <CheckoutElsewhere locator={{ ...locator, team: "usw:team" }} />,
    )
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
    expect(mocks.lookup).toHaveBeenCalledTimes(2)
  })

  it("wraps long team names in the detail and constrains the button label", async () => {
    const name = "long-team-name".repeat(30)
    mocks.lookup.mockResolvedValue({ kind: "switch", team: { ...team, name } })
    render(<CheckoutElsewhere locator={locator} />)
    const button = await screen.findByRole("button", {
      name: `Switch to ${name}`,
    })
    expect(button).toHaveClass("max-w-full")
    expect(button.querySelector("span")).toHaveClass("max-w-full", "truncate")
    expect(
      screen.getByText(
        `This checkout is for ${name}, but a different team is open now. Switch to ${name} to continue.`,
      ),
    ).toHaveClass("break-words")
  })
})
