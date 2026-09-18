import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"
import { teamKeys } from "@/lib/api/query-keys"

import { useBillingPayment } from "./use-billing-payment"

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  portal: vi.fn(),
  toast: vi.fn(),
  scope: vi.fn(),
}))
vi.mock("@/lib/api/billing-stripe", () => ({
  createStripeCheckoutSession: mocks.checkout,
  createStripeCustomerPortalSession: mocks.portal,
}))
vi.mock("@/components/query-provider", () => ({ useQueryScope: mocks.scope }))
vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mocks.toast }),
}))

const summary = {
  permissions: { can_view: true, can_manage: true },
  checkout_available: true,
  portal_available: false,
} as BillingSummaryResponse
function setup(value = summary) {
  const client = new QueryClient()
  client.setQueryData(teamKeys.directory(), {
    activeTeamId: "a",
    activeRegion: "use",
  })
  const hook = renderHook(({ teamKey }) => useBillingPayment(value, teamKey), {
    initialProps: { teamKey: "use:a" },
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  return { ...hook, client }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.scope.mockReturnValue("self")
  window.history.replaceState({}, "", "/sandboxes/?tab=one")
})

it("keeps checkout return conventions and blocks duplicate submission", async () => {
  let reject!: (reason: Error) => void
  mocks.checkout.mockReturnValue(
    new Promise((_resolve, rej) => {
      reject = rej
    }),
  )
  const { result } = setup()
  let pending!: Promise<void>
  act(() => {
    pending = result.current.openSession()
    void result.current.openSession()
  })
  expect(mocks.checkout).toHaveBeenCalledTimes(1)
  const params = mocks.checkout.mock.calls[0][0]
  expect(new URL(params.successUrl).searchParams.get("billing")).toBe("success")
  expect(new URL(params.cancelUrl).searchParams.get("billing")).toBe("cancel")
  expect(new URL(params.successUrl).searchParams.get("tab")).toBe("one")
  await act(async () => {
    reject(new Error("Unavailable"))
    await pending
  })
  expect(mocks.toast).toHaveBeenCalledWith("Unavailable", "error")
  expect(result.current.submitting).toBeNull()
})

it("prefers the existing portal flow", async () => {
  mocks.portal.mockRejectedValue(new Error("Portal unavailable"))
  const { result } = setup({ ...summary, portal_available: true })
  await act(() => result.current.openSession())
  expect(mocks.checkout).not.toHaveBeenCalled()
  expect(
    new URL(mocks.portal.mock.calls[0][0].returnUrl).searchParams.get(
      "billing",
    ),
  ).toBe("portal-return")
})

it.each([false, true])(
  "blocks payment across two hook instances and allows retry after failure (portal: %s)",
  async (portalAvailable) => {
    const request = portalAvailable ? mocks.portal : mocks.checkout
    let reject!: (reason: Error) => void
    request.mockReturnValueOnce(
      new Promise((_resolve, rej) => {
        reject = rej
      }),
    )
    const client = new QueryClient()
    client.setQueryData(teamKeys.directory(), {
      activeTeamId: "a",
      activeRegion: "use",
    })
    const value = { ...summary, portal_available: portalAvailable }
    const { result } = renderHook(
      () => ({
        banner: useBillingPayment(value, "use:a"),
        billingPage: useBillingPayment(value, "use:a"),
      }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.banner.openSession()
      void result.current.billingPage.openSession()
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.current.banner.submitting).toBe(
      portalAvailable ? "portal" : "checkout",
    )
    expect(result.current.billingPage.submitting).toBeNull()

    await act(async () => {
      reject(new Error("First request failed"))
      await pending
    })
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith("First request failed", "error")
    expect(result.current.banner.submitting).toBeNull()

    request.mockRejectedValueOnce(new Error("Retry failed"))
    await act(() => result.current.billingPage.openSession())
    expect(request).toHaveBeenCalledTimes(2)
    expect(
      portalAvailable ? mocks.checkout : mocks.portal,
    ).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenLastCalledWith("Retry failed", "error")
    expect(result.current.billingPage.submitting).toBeNull()
  },
)

it.each([
  { ...summary, permissions: { can_view: true, can_manage: false } },
  { ...summary, checkout_available: false },
])("prevents unauthorized or unavailable invocation", async (value) => {
  const { result } = setup(value)
  await act(() => result.current.openSession())
  expect(mocks.checkout).not.toHaveBeenCalled()
  expect(mocks.portal).not.toHaveBeenCalled()
})

it("prevents payment initiation during impersonation", async () => {
  mocks.scope.mockReturnValue("impersonated-team")
  const { result } = setup()
  await act(() => result.current.openSession())
  expect(mocks.checkout).not.toHaveBeenCalled()
})

it("ignores a late payment error after the cache scope changes", async () => {
  let reject!: (reason: Error) => void
  mocks.checkout.mockReturnValue(
    new Promise((_resolve, rej) => {
      reject = rej
    }),
  )
  const { result, rerender } = setup()
  let pending!: Promise<void>
  act(() => {
    pending = result.current.openSession()
  })
  mocks.scope.mockReturnValue("impersonated-team")
  rerender({ teamKey: "use:a" })
  await act(async () => {
    reject(new Error("Late checkout failure"))
    await pending
  })
  expect(mocks.toast).not.toHaveBeenCalled()
  expect(result.current.submitting).toBeNull()
})

it("ignores a late payment response after team selection changes", async () => {
  let resolve!: (value: { url: string }) => void
  mocks.checkout.mockReturnValue(
    new Promise((res) => {
      resolve = res
    }),
  )
  const { result, client, rerender } = setup()
  let pending!: Promise<void>
  act(() => {
    pending = result.current.openSession()
  })
  client.setQueryData(teamKeys.directory(), {
    activeTeamId: "b",
    activeRegion: "use",
  })
  rerender({ teamKey: "use:b" })
  const originalUrl = window.location.href
  await act(async () => {
    resolve({ url: "https://checkout.stripe.com/late" })
    await pending
  })
  expect(window.location.href).toBe(originalUrl)
  expect(mocks.toast).not.toHaveBeenCalled()
})
