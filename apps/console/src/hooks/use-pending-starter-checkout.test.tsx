import { act, renderHook, waitFor } from "@testing-library/react"
import { StrictMode, type ReactNode } from "react"
import { beforeEach, expect, it, vi } from "vitest"

import { usePendingStarterCheckout } from "./use-pending-starter-checkout"

const recover = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: recover,
}))
const purchase = {
  purchase_id: "33333333-3333-4333-8333-333333333333",
  checkout_generation: "2026-10-27T00:00:00Z",
  amount_cents: 500,
}
const pending = { ...purchase, outcome: "pending_starter_checkout" }
const refresh = vi.fn()
const team = "use:11111111-1111-4111-8111-111111111111"
beforeEach(() => {
  sessionStorage.clear()
  recover.mockReset()
  refresh.mockReset().mockResolvedValue(undefined)
})

it("discovers an original server checkout with empty storage and resumes only the server identity", async () => {
  recover.mockResolvedValueOnce(pending).mockResolvedValueOnce({
    ...purchase,
    outcome: "recovered",
    url: "https://checkout.stripe.com/original",
  })
  const assign = vi
    .spyOn(window.location, "assign")
    .mockImplementation(() => {})
  const { result } = renderHook(() =>
    usePendingStarterCheckout({ team, actor: "actor", enabled: true, refresh }),
  )
  expect(result.current.blocksEntry).toBe(true)
  await waitFor(() => expect(result.current.purchase?.amount_cents).toBe(500))
  expect(sessionStorage.length).toBe(0)
  expect(recover).toHaveBeenCalledExactlyOnceWith(team)
  act(() => {
    result.current.resume()
    result.current.resume()
  })
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/original"),
  )
  expect(recover).toHaveBeenCalledTimes(2)
  expect(recover).toHaveBeenLastCalledWith(team, pending, false)
  assign.mockRestore()
})

it("does not cancel automatically and refreshes authoritative state before clearing an explicit cancelled purchase", async () => {
  recover
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...purchase, outcome: "retryable" })
    .mockResolvedValueOnce({ outcome: "no_pending_starter_checkout" })
  let refreshed!: () => void
  refresh.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        refreshed = resolve
      }),
  )
  const { result } = renderHook(() =>
    usePendingStarterCheckout({ team, actor: "actor", enabled: true, refresh }),
  )
  await waitFor(() => expect(result.current.purchase).toBeTruthy())
  expect(recover).toHaveBeenCalledTimes(1)
  act(() => {
    result.current.cancel()
    result.current.cancel()
  })
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(result.current.blocksEntry).toBe(true)
  expect(recover).toHaveBeenCalledTimes(2)
  await act(async () => refreshed())
  await waitFor(() => expect(result.current.blocksEntry).toBe(false))
  expect(recover).toHaveBeenNthCalledWith(2, team, pending, true)
})

it.each(["actor", "team", "disabled"])(
  "rejects stale discovery and action results after %s changes",
  async (change) => {
    let resolve!: (value: unknown) => void
    recover
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r
          }),
      )
      .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
    const props = { team, actor: "actor", enabled: true, refresh }
    const { result, rerender } = renderHook(
      (p) => usePendingStarterCheckout(p),
      { initialProps: props },
    )
    rerender({
      ...props,
      ...(change === "actor"
        ? { actor: "foreign" }
        : change === "team"
          ? { team: "usw:22222222-2222-4222-8222-222222222222" }
          : { enabled: false }),
    })
    await act(async () => resolve(pending))
    expect(result.current.purchase).toBeUndefined()
    act(() => result.current.cancel())
    expect(recover.mock.calls.every((call) => call.length === 1)).toBe(true)
  },
)

it.each(["error", "forbidden", "uncertain"])(
  "keeps new payment fenced after %s until a successful ordinary status check",
  async (outcome) => {
    if (outcome === "uncertain")
      recover.mockResolvedValueOnce({ outcome: "payment_confirmation_pending" })
    else recover.mockRejectedValueOnce(new Error(outcome))
    recover.mockResolvedValue({ outcome: "no_pending_starter_checkout" })
    const { result } = renderHook(() =>
      usePendingStarterCheckout({
        team,
        actor: "actor",
        enabled: true,
        refresh,
      }),
    )
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.blocksEntry).toBe(true)
    expect(result.current.canStart()).toBe(false)
    act(() => result.current.check())
    await waitFor(() => expect(result.current.canStart()).toBe(true))
  },
)

it("closes the same-tick new-start race while checking a previously clear checkout", async () => {
  recover
    .mockResolvedValueOnce({ outcome: "no_pending_starter_checkout" })
    .mockImplementation(() => new Promise(() => {}))
  const { result } = renderHook(() =>
    usePendingStarterCheckout({ team, actor: "actor", enabled: true, refresh }),
  )
  await waitFor(() => expect(result.current.canStart()).toBe(true))
  act(() => {
    const previous = result.current
    previous.check()
    expect(previous.canStart()).toBe(false)
  })
})

it("does not expose or navigate an old actor's action result after a team switch", async () => {
  let resolve!: (value: unknown) => void
  recover
    .mockResolvedValueOnce(pending)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
  const assign = vi
    .spyOn(window.location, "assign")
    .mockImplementation(() => {})
  const props = { team, actor: "actor", enabled: true, refresh }
  const { result, rerender } = renderHook((p) => usePendingStarterCheckout(p), {
    initialProps: props,
  })
  await waitFor(() => expect(result.current.purchase).toBeTruthy())
  act(() => result.current.resume())
  rerender({ ...props, team: "usw:22222222-2222-4222-8222-222222222222" })
  await act(async () =>
    resolve({
      ...purchase,
      outcome: "recovered",
      url: "https://checkout.stripe.com/original",
    }),
  )
  expect(assign).not.toHaveBeenCalled()
  expect(result.current.purchase).toBeUndefined()
  assign.mockRestore()
})

it("keeps paid or uncertain cancellation fenced without repeating cancellation", async () => {
  recover
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ outcome: "payment_confirmation_pending" })
  const { result } = renderHook(() =>
    usePendingStarterCheckout({ team, actor: "actor", enabled: true, refresh }),
  )
  await waitFor(() => expect(result.current.purchase).toBeTruthy())
  act(() => result.current.cancel())
  await waitFor(() => expect(result.current.error).toMatch(/not confirmed/))
  expect(result.current.blocksEntry).toBe(true)
  expect(recover).toHaveBeenCalledTimes(2)
  expect(refresh).not.toHaveBeenCalled()
})

it("does not lose its discovery result under StrictMode effect replay", async () => {
  recover.mockResolvedValue(pending)
  const { result } = renderHook(
    () =>
      usePendingStarterCheckout({
        team,
        actor: "actor",
        enabled: true,
        refresh,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    },
  )
  await waitFor(() => expect(result.current.purchase?.amount_cents).toBe(500))
  expect(recover).toHaveBeenCalledOnce()
})

it("refreshes paid/settled state on status convergence before permitting another purchase", async () => {
  recover
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ outcome: "no_pending_starter_checkout" })
  const { result } = renderHook(() =>
    usePendingStarterCheckout({ team, actor: "actor", enabled: true, refresh }),
  )
  await waitFor(() => expect(result.current.purchase).toBeTruthy())
  act(() => result.current.check())
  await waitFor(() => expect(result.current.blocksEntry).toBe(false))
  expect(refresh).toHaveBeenCalledOnce()
  expect(recover.mock.calls.every((call) => call.length === 1)).toBe(true)
})
it("retains the purchase guard when authoritative refresh fails after cancellation", async () => {
  recover
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...purchase, outcome: "retryable" })
  refresh.mockRejectedValue(new Error("summary unavailable"))
  const { result } = renderHook(() =>
    usePendingStarterCheckout({ team, actor: "actor", enabled: true, refresh }),
  )
  await waitFor(() => expect(result.current.purchase).toBeTruthy())
  act(() => result.current.cancel())
  await waitFor(() => expect(result.current.error).toMatch(/Unable to confirm/))
  expect(result.current.blocksEntry).toBe(true)
  expect(recover).toHaveBeenCalledTimes(2)
})
