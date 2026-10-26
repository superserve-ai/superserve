import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import ProPaymentPage from "@/app/(dashboard)/billing/pro/page"
import { BuyCreditRoute } from "@/app/(dashboard)/plan-usage/buy-credit/route-client"

import { PlanBanner } from "./plan-banner"
const team = "use:11111111-1111-4111-8111-111111111111"
const otherTeam = "use:22222222-2222-4222-8222-222222222222"
const state = vi.hoisted(() => ({
  recover: vi.fn(),
  start: vi.fn(),
  resume: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
  replace: vi.fn(),
  prepaid: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ replace: state.replace }),
}))
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: state.invalidate,
    isMutating: () => 0,
  }),
  useIsMutating: () => 0,
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: state.toast }),
}))
vi.mock("@/components/query-provider", () => ({
  useDashboardTeamContext: () => ({
    teamId: "11111111-1111-4111-8111-111111111111",
    region: "use",
  }),
  useQueryScope: () => "self",
}))
vi.mock("@/components/page-header", () => ({
  PageHeader: () => <h1>Billing</h1>,
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "actor" } }),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    ready: true,
    teamKey: "use:11111111-1111-4111-8111-111111111111",
  }),
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({
    data: { permissions: { can_manage: true, can_view: true } },
    isError: false,
  }),
}))
vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersion: () => "v2",
}))
vi.mock("@/hooks/use-billing-v2", () => ({
  useTeamPlan: () => ({ data: { kind: "prepaid" } }),
  useProCheckoutTerms: () => ({ data: undefined }),
  usePrepaidBalance: () => ({ data: null }),
}))
vi.mock("./plan-aware-banner", () => ({
  PlanAwareBanner: () => <aside>Current plan banner</aside>,
}))
vi.mock("@/hooks/use-public-billing-plans", () => ({
  usePublicBillingPlans: () => ({ data: undefined }),
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: {
      teams: [{ id: "22222222-2222-4222-8222-222222222222", region: "use" }],
    },
  }),
  useSwitchTeam: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: (enabled: boolean) => {
    state.prepaid(enabled)
    return {
      data: {
        balance_cents: 12500,
        purchases: [],
        auto_recharge: { enabled: false },
      },
    }
  },
  useRetainedPrepaidOperations: () => [],
}))
vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: async () => ({
    outcome: "no_pending_starter_checkout",
  }),
}))
vi.mock("@/lib/api/plan-checkout", () => ({
  recoverProPayment: (...args: unknown[]) => state.recover(...args),
  startProCheckout: (...args: unknown[]) => state.start(...args),
  resumeProCheckout: (...args: unknown[]) => state.resume(...args),
  isStripeCheckoutUrl: () => false,
}))
beforeEach(() => {
  vi.clearAllMocks()
  state.recover.mockResolvedValue("none")
  window.history.replaceState({}, "", "/")
})
async function renderPro(query: string) {
  window.history.replaceState({}, "", `/billing/pro/?${query}`)
  const params: Record<string, string | string[]> = {}
  const search = new URLSearchParams(query)
  search.forEach((_, key) => {
    const values = search.getAll(key)
    params[key] = values.length === 1 ? values[0]! : values
  })
  const route = await ProPaymentPage({ searchParams: Promise.resolve(params) })
  return render(
    <>
      <PlanBanner />
      {route}
    </>,
  )
}
describe("global billing banner composed with checkout routes", () => {
  it.each(["success", "cancel"])(
    "preserves the wrong-team Pro %s callback",
    async (result) => {
      const query = `billing=${result}&team=${otherTeam}&return=%2Fplan-usage%2F`
      await renderPro(query)
      expect(screen.getByText("Current plan banner")).toBeTruthy()
      expect(
        screen.getByRole("button", { name: "Return to checkout team" }),
      ).toBeTruthy()
      expect(window.location.search).toBe(`?${query}`)
      expect(state.recover).not.toHaveBeenCalled()
      expect(state.start).not.toHaveBeenCalled()
      expect(state.toast).not.toHaveBeenCalled()
      expect(state.invalidate).not.toHaveBeenCalled()
    },
  )
  it("allows matching-team Pro status recovery without consuming its result", async () => {
    const query = `billing=success&team=${team}`
    await renderPro(query)
    expect(state.recover).toHaveBeenCalledWith(team)
    expect(window.location.search).toBe(`?${query}`)
    expect(state.start).not.toHaveBeenCalled()
    expect(state.toast).not.toHaveBeenCalled()
  })
  it.each(["billing=unknown", "billing=success&billing=cancel"])(
    "does not erase invalid Pro marker %s",
    async (result) => {
      const query = `${result}&team=${team}`
      await renderPro(query)
      expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
      expect(window.location.search).toBe(`?${query}`)
      expect(
        screen.queryByRole("button", { name: /Continue to payment/ }),
      ).toBeNull()
      expect(state.recover).not.toHaveBeenCalled()
      expect(state.start).not.toHaveBeenCalled()
    },
  )
  it.each(["success", "cancel"])(
    "preserves Starter %s callback and isolation",
    (result) => {
      const query = `purchase=${result}&team=${otherTeam}&purchase_id=33333333-3333-4333-8333-333333333333`
      window.history.replaceState({}, "", `/plan-usage/buy-credit/?${query}`)
      render(
        <>
          <PlanBanner />
          <BuyCreditRoute />
        </>,
      )
      expect(
        screen.getByRole("button", { name: "Return to checkout team" }),
      ).toBeTruthy()
      expect(window.location.search).toBe(`?${query}`)
      expect(screen.queryByText("$125")).toBeNull()
      expect(state.prepaid).toHaveBeenLastCalledWith(false)
    },
  )
  it("does not erase unexpected billing from invalid Starter callback", () => {
    const query = `purchase=success&team=${team}&billing=success`
    window.history.replaceState({}, "", `/plan-usage/buy-credit/?${query}`)
    render(
      <>
        <PlanBanner />
        <BuyCreditRoute />
      </>,
    )
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(window.location.search).toBe(`?${query}`)
    expect(state.prepaid).toHaveBeenLastCalledWith(false)
  })
  it.each(["/plan-usage", "/plan-usage/"])(
    "leaves %s consumption to inline notice",
    (path) => {
      window.history.replaceState({}, "", `${path}?billing=success`)
      render(<PlanBanner />)
      expect(window.location.search).toBe("?billing=success")
      expect(state.toast).not.toHaveBeenCalled()
      expect(state.invalidate).not.toHaveBeenCalled()
    },
  )
  it("still consumes ordinary dashboard Stripe returns", () => {
    window.history.replaceState({}, "", "/sandboxes/?billing=success&keep=1")
    render(<PlanBanner />)
    expect(window.location.search).toBe("?keep=1")
    expect(state.toast).toHaveBeenCalledWith(
      expect.stringContaining("Returned from Stripe"),
      "info",
    )
    expect(state.invalidate).toHaveBeenCalled()
  })
})
