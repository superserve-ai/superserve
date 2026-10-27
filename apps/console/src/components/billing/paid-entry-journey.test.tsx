import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import ProPage from "@/app/(dashboard)/billing/pro/page"
import { ProPayment } from "@/app/(dashboard)/billing/pro/pro-payment"
import { BuyCreditRoute } from "@/app/(dashboard)/plan-usage/buy-credit/route-client"
import { GET as prepare } from "@/app/api/onboarding/prepare/route"
import { SessionExpiryRedirect } from "@/components/layout/session-expiry-redirect"
import { ApiError } from "@/lib/api/client"
import { SIGNUP_OFFER_DESTINATIONS } from "@/lib/auth/signup-offer"
import { signupPreparationReturnPath } from "@/lib/billing/pro-auth-return"

const id = "11111111-1111-4111-8111-111111111111"
const teamKey = `use:${id}`
const state = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue({ isError: false }),
  teamKey: "use:11111111-1111-4111-8111-111111111111",
  query: "",
  member: true,
  pricing: "v2" as "v2" | "legacy" | undefined,
  prepare: vi.fn(),
  start: vi.fn(),
  recover: vi.fn(),
  starterRecover: vi.fn(),
  switch: vi.fn(),
  signout: vi.fn(),
  assign: vi.fn(),
  authChange: undefined as undefined | ((event: string) => void),
}))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw { redirect: path }
  },
  unstable_rethrow: (error: unknown) => {
    if (error && typeof error === "object" && "redirect" in error) throw error
  },
  useSearchParams: () => new URLSearchParams(state.query),
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: (...args: unknown[]) => state.prepare(...args),
}))
vi.mock("@/components/page-header", () => ({ PageHeader: () => null }))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => "self",
  useDashboardTeamContext: () => null,
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    ready: true,
    teamKey: state.teamKey,
    cacheScope: "self",
  }),
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: {
      teams: [
        { id: state.teamKey.split(":")[1], region: "use" },
        ...(state.member ? [{ id, region: "use" }] : []),
      ],
      activeTeamId: state.teamKey.split(":")[1],
      activeRegion: "use",
    },
  }),
  useSwitchTeam: () => ({ mutateAsync: state.switch }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "actor" } }),
}))
vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersion: () => state.pricing,
}))
vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({
    refetch: state.refresh,
    data: {
      pricing_version: state.pricing,
      entry_open: state.pricing === "v2",
      fresh_entry: {
        starter: state.pricing === "v2",
        pro: state.pricing === "v2",
        auto_recharge: state.pricing === "v2",
      },
      catalog: {
        pricing_version: state.pricing,
        cards: [
          {
            family: "pro",
            name: "Pro",
            features: [],
            monthly: { available: true, price_cents: 25000 },
            limits: {},
          },
        ],
      },
    },
  }),
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({
    data: { permissions: { can_manage: true } },
    refetch: state.refresh,
  }),
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: () => ({
    data: {
      checkout_idempotency_supported: true,
      balance_cents: 0,
      purchases: [],
      auto_recharge: { enabled: false },
      has_saved_card: false,
    },
  }),
  useRetainedPrepaidOperations: () => [],
}))
vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: (...args: unknown[]) => state.starterRecover(...args),
}))
vi.mock("@/lib/api/plan-checkout", () => ({
  startProCheckout: (...args: unknown[]) => state.start(...args),
  recoverProPayment: (...args: unknown[]) => state.recover(...args),
  resumeProCheckout: vi.fn(),
  isStripeCheckoutUrl: (value: string) =>
    value.startsWith("https://checkout.stripe.com/"),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      signOut: state.signout,
      onAuthStateChange: (callback: (event: string) => void) => {
        state.authChange = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  }),
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))
function show(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
    {
      wrapper: ({ children }) => (
        <>
          <SessionExpiryRedirect />
          {children}
        </>
      ),
    },
  )
}

async function preparedDestination(next: string, team?: string) {
  const url = new URL("https://console.test/api/onboarding/prepare/")
  url.searchParams.set("account", "actor")
  if (team) url.searchParams.set("team", team)
  url.searchParams.set("next", next)
  expect(signupPreparationReturnPath(url.pathname + url.search)).not.toBeNull()
  let destination: string | undefined
  try {
    await prepare(new Request(url))
  } catch (error) {
    destination = (error as { redirect?: string }).redirect
  }
  expect(destination).toBeTruthy()
  const target = new URL(destination!, url)
  expect(state.prepare).toHaveBeenLastCalledWith(
    team,
    "actor",
    undefined,
    target.pathname + target.search,
  )
  state.query = target.searchParams.toString()
  return target
}

async function readyContinue() {
  const button = await screen.findByRole("button", {
    name: "Continue to payment",
  })
  await waitFor(() => expect(button).not.toBeDisabled())
  return button
}
beforeEach(() => {
  state.teamKey = teamKey
  state.query = ""
  state.member = true
  state.pricing = "v2"
  state.prepare.mockReset().mockResolvedValue(undefined)
  state.starterRecover
    .mockReset()
    .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
  state.start.mockReset().mockResolvedValue(null)
  state.recover.mockReset().mockResolvedValue("payment_confirmation_pending")
  state.switch.mockReset().mockResolvedValue(undefined)
  state.signout.mockReset().mockResolvedValue({ error: null })
  state.assign.mockReset()
  vi.stubGlobal("location", {
    assign: state.assign,
    origin: "https://console.test",
  })
})
describe("actual signup preparation to paid page journey", () => {
  it("allows a fresh ordinary Pro offer produced by signup", async () => {
    const target = await preparedDestination(
      SIGNUP_OFFER_DESTINATIONS.pro_monthly,
    )
    const page = await ProPage({
      searchParams: Promise.resolve(Object.fromEntries(target.searchParams)),
    })
    show(page)
    fireEvent.click(await readyContinue())
    await waitFor(() =>
      expect(state.start).toHaveBeenCalledWith(
        teamKey,
        "pro_monthly",
        expect.any(String),
        "actor",
      ),
    )
  })
  it("accepts the real account-setup producer's team-pinned Pro intent with its nested return", async () => {
    const target = await preparedDestination(
      "/billing/pro/?return=%2Fsandboxes%2F%3Fview%3Dall",
      teamKey,
    )
    const page = await ProPage({
      searchParams: Promise.resolve(Object.fromEntries(target.searchParams)),
    })
    show(page)
    expect(state.start).not.toHaveBeenCalled()
    fireEvent.click(await readyContinue())
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
    const checkoutReturn = new URL(state.start.mock.calls[0]![2])
    expect(checkoutReturn.searchParams.get("team")).toBe(teamKey)
    expect(checkoutReturn.searchParams.get("return")).toBe(
      "/sandboxes/?view=all",
    )
  })
  it.each(["member", "other-account"])(
    "preserves pinned fresh Pro intent across %s recovery without buying",
    async (account) => {
      const target = await preparedDestination(
        "/billing/pro/?return=%2Fsandboxes%2F",
        teamKey,
      )
      state.teamKey = "use:22222222-2222-4222-8222-222222222222"
      state.member = account === "member"
      const page = await ProPage({
        searchParams: Promise.resolve(Object.fromEntries(target.searchParams)),
      })
      show(page)
      expect(
        screen.queryByRole("button", { name: "Continue to payment" }),
      ).toBeNull()
      if (state.member) {
        fireEvent.click(
          screen.getByRole("button", { name: "Return to signup team" }),
        )
        await waitFor(() =>
          expect(state.switch).toHaveBeenCalledWith({
            teamId: id,
            region: "use",
          }),
        )
      } else {
        expect(
          screen.queryByRole("button", { name: "Return to signup team" }),
        ).toBeNull()
        fireEvent.click(
          screen.getByRole("button", {
            name: "Sign out and use signup account",
          }),
        )
        await waitFor(() =>
          expect(state.assign).toHaveBeenCalledWith(
            `/auth/signin?next=${encodeURIComponent(target.pathname + target.search)}`,
          ),
        )
      }
      expect(state.start).not.toHaveBeenCalled()
      expect(state.recover).not.toHaveBeenCalled()
    },
  )
  it.each(["legacy", "v2"] as const)(
    "accepts the real Starter preparation team pin under %s entry policy",
    async (pricing) => {
      await preparedDestination(SIGNUP_OFFER_DESTINATIONS.starter, teamKey)
      state.pricing = pricing
      show(<BuyCreditRoute />)
      if (pricing === "legacy")
        expect(
          screen.queryByRole("button", { name: /Buy .* credit/ }),
        ).toBeNull()
      else
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: /Buy .* credit/ }),
          ).not.toBeDisabled(),
        )
      expect(screen.queryByText(/incomplete or invalid/)).toBeNull()
    },
  )

  it.each(["member", "other-account"])(
    "restores a fresh Starter pin across %s without starting checkout",
    async (account) => {
      const target = await preparedDestination(
        "/plan-usage/buy-credit/?amount=500",
        teamKey,
      )
      state.teamKey = "use:22222222-2222-4222-8222-222222222222"
      state.member = account === "member"
      show(<BuyCreditRoute />)
      expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
      if (state.member) {
        fireEvent.click(
          screen.getByRole("button", { name: "Return to signup team" }),
        )
        await waitFor(() =>
          expect(state.switch).toHaveBeenCalledWith({
            teamId: id,
            region: "use",
          }),
        )
      } else {
        fireEvent.click(
          screen.getByRole("button", {
            name: "Sign out and use signup account",
          }),
        )
        await waitFor(() =>
          expect(state.assign).toHaveBeenCalledWith(
            `/auth/signin?next=${encodeURIComponent(target.pathname + target.search)}`,
          ),
        )
      }
      expect(state.start).not.toHaveBeenCalled()
    },
  )
  it.each(["success", "cancel"])(
    "preserves a real prepared Pro %s callback without starting another purchase",
    async (result) => {
      const target = await preparedDestination(
        `/billing/pro/?billing=${result}&team=${teamKey}&return=%2Fsandboxes%2F`,
        teamKey,
      )
      state.recover.mockResolvedValue("active")
      const page = await ProPage({
        searchParams: Promise.resolve(Object.fromEntries(target.searchParams)),
      })
      show(page)
      if (result === "success")
        await waitFor(() => expect(state.recover).toHaveBeenCalledWith(teamKey))
      else expect(state.recover).not.toHaveBeenCalled()
      expect(screen.queryByText(/incomplete or invalid/)).toBeNull()
      expect(state.start).not.toHaveBeenCalled()
    },
  )

  it.each(["no_pending_pro_purchase", "retryable"])(
    "keeps the original fresh pin after conflict recovery reports %s",
    async (outcome) => {
      const target = await preparedDestination(
        "/billing/pro/?return=%2Fsandboxes%2F",
        teamKey,
      )
      state.start.mockRejectedValueOnce(
        new ApiError(
          409,
          "plan_conflict",
          "A payment is already being checked",
        ),
      )
      state.recover.mockResolvedValue(outcome)
      const page = await ProPage({
        searchParams: Promise.resolve(Object.fromEntries(target.searchParams)),
      })
      show(page)
      fireEvent.click(await readyContinue())
      await screen.findByText(
        "This team already has a paid plan or a payment in progress.",
      )
      fireEvent.click(
        screen.getByRole("button", { name: "Check payment status" }),
      )
      const retry = await screen.findByRole("button", {
        name: "Continue to payment",
      })
      fireEvent.click(retry)
      await waitFor(() => expect(state.start).toHaveBeenCalledTimes(2))
      expect(state.start.mock.calls.every(([team]) => team === teamKey)).toBe(
        true,
      )
      expect(screen.queryByText(/incomplete or invalid/)).toBeNull()
    },
  )
  it("uses a new real prepared pin after same-route navigation instead of retaining the previous team's operation", async () => {
    const first = await preparedDestination("/billing/pro/", teamKey)
    const view = show(
      await ProPage({
        searchParams: Promise.resolve(Object.fromEntries(first.searchParams)),
      }),
    )
    const other = "use:22222222-2222-4222-8222-222222222222"
    const second = await preparedDestination("/billing/pro/", other)
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        {await ProPage({
          searchParams: Promise.resolve(
            Object.fromEntries(second.searchParams),
          ),
        })}
      </QueryClientProvider>,
    )
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).toBeNull()
    expect(state.start).not.toHaveBeenCalled()
    state.teamKey = other
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        {await ProPage({
          searchParams: Promise.resolve(
            Object.fromEntries(second.searchParams),
          ),
        })}
      </QueryClientProvider>,
    )
    fireEvent.click(await readyContinue())
    await waitFor(() =>
      expect(state.start).toHaveBeenCalledWith(
        other,
        "pro_monthly",
        expect.any(String),
        "actor",
      ),
    )
  })

  it("ignores an old checkout response after actual prepared destination changes", async () => {
    const first = await preparedDestination("/billing/pro/", teamKey)
    let finish!: (url: string) => void
    state.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const view = show(
      await ProPage({
        searchParams: Promise.resolve(Object.fromEntries(first.searchParams)),
      }),
    )
    fireEvent.click(await readyContinue())
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
    const second = await preparedDestination(
      "/billing/pro/?return=%2Fsandboxes%2F%3Fview%3Dupdated",
      teamKey,
    )
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        {await ProPage({
          searchParams: Promise.resolve(
            Object.fromEntries(second.searchParams),
          ),
        })}
      </QueryClientProvider>,
    )
    await act(async () => finish("https://checkout.stripe.com/c/pay/old-team"))
    expect(state.assign).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Continue to payment" }),
    ).not.toBeDisabled()
  })

  it.each([
    ["start-null", false],
    ["manual-pending", false],
    ["start-null", true],
    ["manual-pending", true],
  ] as const)(
    "restores the original in-page %s payment team, URL pin=%s, without starting another purchase",
    async (producer, pinned) => {
      const target = await preparedDestination(
        "/billing/pro/?return=%2Fsandboxes%2F%3Fview%3Doriginal",
        pinned ? teamKey : undefined,
      )
      if (producer === "manual-pending") state.pricing = "legacy"
      const props = {
        searchParams: Promise.resolve(Object.fromEntries(target.searchParams)),
      }
      const view = show(await ProPage(props))
      if (producer === "start-null") await readyContinue()
      fireEvent.click(
        screen.getByRole("button", {
          name:
            producer === "start-null"
              ? "Continue to payment"
              : "Check payment status",
        }),
      )
      await screen.findByText(/Payment status is pending/)
      const started = producer === "start-null" ? 1 : 0
      expect(state.start).toHaveBeenCalledTimes(started)
      state.teamKey = "use:22222222-2222-4222-8222-222222222222"
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          {await ProPage(props)}
        </QueryClientProvider>,
      )
      expect(screen.queryByText(/incomplete or invalid/)).toBeNull()
      fireEvent.click(
        screen.getByRole("button", { name: "Return to checkout team" }),
      )
      await waitFor(() =>
        expect(state.switch).toHaveBeenCalledWith({
          teamId: id,
          region: "use",
        }),
      )
      state.teamKey = teamKey
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          {await ProPage(props)}
        </QueryClientProvider>,
      )
      fireEvent.click(screen.getByRole("button", { name: "Check again" }))
      await waitFor(() => expect(state.recover).toHaveBeenCalledWith(teamKey))
      expect(state.start).toHaveBeenCalledTimes(started)
    },
  )
  it.each([
    ["start-null", false],
    ["manual-pending", false],
    ["start-null", true],
    ["manual-pending", true],
  ] as const)(
    "retains the original %s operation, URL pin=%s, through sign-in and checks its status without a new purchase",
    async (producer, pinned) => {
      const target = await preparedDestination(
        "/billing/pro/?return=%2Fsandboxes%2F%3Fview%3Doriginal",
        pinned ? teamKey : undefined,
      )
      if (producer === "manual-pending") state.pricing = "legacy"
      const props = {
        searchParams: Promise.resolve(Object.fromEntries(target.searchParams)),
      }
      const view = show(await ProPage(props))
      if (producer === "start-null") await readyContinue()
      fireEvent.click(
        screen.getByRole("button", {
          name:
            producer === "start-null"
              ? "Continue to payment"
              : "Check payment status",
        }),
      )
      await screen.findByText(/Payment status is pending/)
      const started = producer === "start-null" ? 1 : 0
      state.teamKey = "use:22222222-2222-4222-8222-222222222222"
      state.member = false
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          {await ProPage(props)}
        </QueryClientProvider>,
      )
      vi.stubGlobal("location", {
        origin: "https://console.test",
        assign: state.assign,
        pathname: target.pathname,
        search: target.search,
      })
      state.signout.mockImplementation(async () => {
        state.authChange?.("SIGNED_OUT")
        return { error: null }
      })
      fireEvent.click(
        screen.getByRole("button", {
          name: "Sign out and use checkout account",
        }),
      )
      await waitFor(() => expect(state.assign).toHaveBeenCalled())
      const signIn = new URL(
        state.assign.mock.calls[0]![0],
        "https://console.test",
      )
      const retained = new URL(signIn.searchParams.get("next")!, signIn)
      expect(retained.searchParams.get("team")).toBe(teamKey)
      expect(retained.searchParams.get("return")).toBe(
        "/sandboxes/?view=original",
      )
      expect(retained.searchParams.get("billing")).toBe("success")
      expect(
        state.assign.mock.calls.every(
          ([url]) =>
            url ===
            `/auth/signin?next=${encodeURIComponent(retained.pathname + retained.search)}`,
        ),
      ).toBe(true)
      state.teamKey = teamKey
      state.member = true
      state.query = retained.searchParams.toString()
      state.recover.mockClear().mockResolvedValue("active")
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          {await ProPage({
            searchParams: Promise.resolve(
              Object.fromEntries(retained.searchParams),
            ),
          })}
        </QueryClientProvider>,
      )
      await waitFor(() => expect(state.recover).toHaveBeenCalledWith(teamKey))
      expect(state.start).toHaveBeenCalledTimes(started)
    },
  )
  it.each([
    "billing=",
    "billing=invalid",
    "billing=success&billing=cancel",
    "billing=success&team=invalid",
  ])("keeps malformed Pro callback %s separate from fresh entry", (query) => {
    state.query = query
    show(<ProPayment returnTo="/plan-usage/" />)
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Continue to payment" }),
    ).toBeNull()
    expect(state.start).not.toHaveBeenCalled()
    expect(state.recover).not.toHaveBeenCalled()
  })
})

it("finds the original server purchase from normal team-pinned Pro entry without a result marker", async () => {
  sessionStorage.clear()
  state.starterRecover.mockResolvedValue({
    outcome: "pending_starter_checkout",
    purchase_id: "33333333-3333-4333-8333-333333333333",
    checkout_generation: "2026-10-27T00:00:00Z",
    amount_cents: 500,
  })
  const target = await preparedDestination("/billing/pro/", teamKey)
  expect(target.searchParams.has("billing")).toBe(false)
  show(
    await ProPage({
      searchParams: Promise.resolve(Object.fromEntries(target.searchParams)),
    }),
  )
  await screen.findByRole("button", { name: "Resume your $5 credit purchase" })
  expect(
    screen.getByRole("button", { name: "Cancel this purchase and choose Pro" }),
  ).not.toBeDisabled()
  expect(state.start).not.toHaveBeenCalled()
  expect(state.recover).not.toHaveBeenCalled()
  expect(state.starterRecover).toHaveBeenCalledExactlyOnceWith(teamKey)
})
