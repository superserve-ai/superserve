import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CheckoutContextRecovery } from "./checkout-context-recovery"
const state = vi.hoisted(() => ({
  actor: "actor-a",
  member: true,
  switch: vi.fn(),
  signOut: vi.fn(),
  assign: vi.fn(),
}))
const teamId = "11111111-1111-4111-8111-111111111111"
const callback = `/plan-usage/buy-credit/?purchase=success&team=use:${teamId}&purchase_id=22222222-2222-4222-8222-222222222222`
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: { teams: state.member ? [{ id: teamId, region: "use" }] : [] },
  }),
  useSwitchTeam: () => ({ mutateAsync: state.switch }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: state.actor } }),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signOut: state.signOut } }),
}))
beforeEach(() => {
  state.actor = "actor-a"
  state.member = true
  state.switch.mockReset().mockResolvedValue(undefined)
  state.signOut.mockReset().mockResolvedValue({ error: null })
  state.assign.mockReset()
  vi.stubGlobal("location", { assign: state.assign })
})
describe("checkout context recovery", () => {
  it("returns to a member team only after an explicit click", async () => {
    render(<CheckoutContextRecovery callbackPath={callback} />)
    expect(state.switch).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: "Return to checkout team" }),
    )
    await waitFor(() =>
      expect(state.switch).toHaveBeenCalledWith({ teamId, region: "use" }),
    )
    expect(state.signOut).not.toHaveBeenCalled()
  })
  it("offers different-account recovery without exposing a nonmember team", async () => {
    state.member = false
    render(<CheckoutContextRecovery callbackPath={callback} />)
    expect(
      screen.queryByRole("button", { name: "Return to checkout team" }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    )
    await waitFor(() =>
      expect(state.assign).toHaveBeenCalledWith(
        `/auth/signin?next=${encodeURIComponent(callback)}`,
      ),
    )
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" })
  })
  it.each(["switch", "signout"])(
    "allows retry after %s failure",
    async (kind) => {
      const work = kind === "switch" ? state.switch : state.signOut
      work.mockRejectedValueOnce(new Error("unavailable"))
      render(<CheckoutContextRecovery callbackPath={callback} />)
      const button = screen.getByRole("button", {
        name:
          kind === "switch"
            ? "Return to checkout team"
            : "Sign out and use checkout account",
      })
      fireEvent.click(button)
      await screen.findByText("Unable to restore checkout. Please try again.")
      fireEvent.click(button)
      await waitFor(() => expect(work).toHaveBeenCalledTimes(2))
    },
  )
  it("does not redirect a stale account signout completion", async () => {
    let finish!: (value: { error: null }) => void
    state.signOut.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const view = render(<CheckoutContextRecovery callbackPath={callback} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    )
    state.actor = "actor-b"
    view.rerender(<CheckoutContextRecovery callbackPath={callback} />)
    await act(async () => finish({ error: null }))
    expect(state.assign).not.toHaveBeenCalled()
  })
  it("fails closed on an unsafe callback", () => {
    render(<CheckoutContextRecovery callbackPath="//evil.test" />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(state.switch).not.toHaveBeenCalled()
    expect(state.signOut).not.toHaveBeenCalled()
  })
})
