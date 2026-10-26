import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SessionExpiryRedirect } from "@/components/layout/session-expiry-redirect"

import { CheckoutContextRecovery } from "./checkout-context-recovery"
const state = vi.hoisted(() => ({
  actor: "actor-a" as string | undefined,
  refetch: vi.fn(),
  directoryError: false,
  authChange: undefined as undefined | ((event: string) => void),
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
    refetch: state.refetch,
    isError: state.directoryError,
  }),
  useSwitchTeam: () => ({ mutateAsync: state.switch }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: state.actor } }),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      signOut: state.signOut,
      onAuthStateChange: (callback: (event: string) => void) => {
        state.authChange = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  }),
}))
beforeEach(() => {
  state.actor = "actor-a"
  state.member = true
  state.switch.mockReset().mockResolvedValue(undefined)
  state.signOut.mockReset().mockResolvedValue({ error: null })
  state.assign.mockReset()
  state.refetch.mockReset()
  state.directoryError = false
  state.authChange = undefined
  vi.stubGlobal("location", { assign: state.assign })
})
function render(ui: ReactNode, client = new QueryClient()) {
  return renderView(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}
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
  it.each(["switch", "create"])(
    "blocks lookup retry during a real external team %s and enables it after completion",
    async (operation) => {
      const client = new QueryClient()
      let complete!: () => void
      const mutation = client.getMutationCache().build(client, {
        mutationKey: ["switch-team", operation],
        mutationFn: () =>
          new Promise<void>((resolve) => {
            complete = resolve
          }),
      })
      const pending = mutation.execute(undefined)
      render(
        <CheckoutContextRecovery callbackPath={callback} contextPending />,
        client,
      )
      const retry = screen.getByRole("button", { name: "Retry team lookup" })
      await waitFor(() => expect(retry).toBeDisabled())
      fireEvent.click(retry)
      expect(state.refetch).not.toHaveBeenCalled()
      expect(
        screen.getByRole("button", {
          name: "Sign out and use checkout account",
        }),
      ).toBeDisabled()
      await act(async () => {
        complete()
        await pending
      })
      await waitFor(() => expect(retry).not.toBeDisabled())
      fireEvent.click(retry)
      expect(state.refetch).toHaveBeenCalledOnce()
    },
  )
  it("keeps retry and account recovery enabled for unresolved directory without a mutation", () => {
    render(<CheckoutContextRecovery callbackPath={callback} contextPending />)
    expect(
      screen.getByRole("button", { name: "Retry team lookup" }),
    ).not.toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    ).not.toBeDisabled()
  })
  it("keeps directory-error retry enabled when no team mutation is active", () => {
    state.directoryError = true
    render(<CheckoutContextRecovery callbackPath={callback} />)
    fireEvent.click(screen.getByRole("button", { name: "Retry team lookup" }))
    expect(state.refetch).toHaveBeenCalledOnce()
  })
  it.each([
    callback,
    `/billing/pro/?billing=success&team=use:${teamId}&return=%2Fsandboxes%2F%3Fview%3Dall`,
  ])(
    "retains exact callback through SIGNED_OUT before signout completes: %s",
    async (path) => {
      vi.stubGlobal("location", {
        assign: state.assign,
        pathname: "/billing/pro/",
        search: "?return=%2Fsandboxes%2F",
      })
      let finish!: (value: { error: null }) => void
      state.signOut.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const view = render(
        <>
          <SessionExpiryRedirect />
          <CheckoutContextRecovery callbackPath={path} />
        </>,
      )
      fireEvent.click(
        screen.getByRole("button", {
          name: "Sign out and use checkout account",
        }),
      )
      await act(async () => {
        state.authChange?.("SIGNED_OUT")
        state.actor = undefined
      })
      view.rerender(
        <>
          <SessionExpiryRedirect />
          <CheckoutContextRecovery callbackPath={path} />
        </>,
      )
      await act(async () => finish({ error: null }))
      expect(state.assign).toHaveBeenCalledWith(
        `/auth/signin?next=${encodeURIComponent(path)}`,
      )
      expect(
        state.assign.mock.calls.every(
          ([url]) => url === `/auth/signin?next=${encodeURIComponent(path)}`,
        ),
      ).toBe(true)
    },
  )
  it("clears the deliberate destination on signout failure so later session expiry uses current navigation", async () => {
    vi.stubGlobal("location", {
      assign: state.assign,
      pathname: "/billing/pro/",
      search: "?return=%2Fsandboxes%2F",
    })
    state.signOut.mockResolvedValueOnce({ error: new Error("unavailable") })
    render(
      <>
        <SessionExpiryRedirect />
        <CheckoutContextRecovery callbackPath={callback} />
      </>,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    )
    await screen.findByText("Unable to restore checkout. Please try again.")
    await act(async () => state.authChange?.("SIGNED_OUT"))
    expect(state.assign).toHaveBeenCalledWith(
      `/auth/signin?next=${encodeURIComponent("/billing/pro/?return=%2Fsandboxes%2F")}`,
    )
  })
  it("retains the pending destination when actor hydration completes before SIGNED_OUT", async () => {
    state.actor = undefined
    vi.stubGlobal("location", {
      assign: state.assign,
      pathname: "/billing/pro/",
      search: "",
    })
    let finish!: (value: { error: null }) => void
    state.signOut.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const view = render(
      <>
        <SessionExpiryRedirect />
        <CheckoutContextRecovery callbackPath={callback} />
      </>,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    )
    state.actor = "actor-a"
    view.rerender(
      <>
        <SessionExpiryRedirect />
        <CheckoutContextRecovery callbackPath={callback} />
      </>,
    )
    const signOut = screen.getByRole("button", {
      name: "Sign out and use checkout account",
    })
    expect(signOut).toBeDisabled()
    fireEvent.click(signOut)
    expect(state.signOut).toHaveBeenCalledOnce()
    await act(async () => state.authChange?.("SIGNED_OUT"))
    expect(state.assign).toHaveBeenCalledWith(
      `/auth/signin?next=${encodeURIComponent(callback)}`,
    )
    await act(async () => finish({ error: null }))
    expect(
      state.assign.mock.calls.every(
        ([url]) => url === `/auth/signin?next=${encodeURIComponent(callback)}`,
      ),
    ).toBe(true)
  })
  it("clears an obsolete return override when the recovery path changes during signout", async () => {
    let finish!: (value: { error: null }) => void
    state.signOut.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const view = render(
      <>
        <SessionExpiryRedirect />
        <CheckoutContextRecovery callbackPath={callback} />
      </>,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    )
    const next = `/billing/pro/?team=use:${teamId}&billing=cancel`
    const url = new URL(next, "https://console.test")
    vi.stubGlobal("location", {
      assign: state.assign,
      pathname: url.pathname,
      search: url.search,
    })
    view.rerender(
      <>
        <SessionExpiryRedirect />
        <CheckoutContextRecovery callbackPath={next} />
      </>,
    )
    await act(async () => state.authChange?.("SIGNED_OUT"))
    expect(state.assign).toHaveBeenCalledWith(
      `/auth/signin?next=${encodeURIComponent(next)}`,
    )
    await act(async () => finish({ error: null }))
    expect(
      state.assign.mock.calls.every(
        ([value]) => value === `/auth/signin?next=${encodeURIComponent(next)}`,
      ),
    ).toBe(true)
  })
})
