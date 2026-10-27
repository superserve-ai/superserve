import { render, screen, waitFor } from "@testing-library/react"
import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import AuthCodeErrorPage from "@/app/(auth)/auth/auth-code-error/page"
import SignInPage from "@/app/(auth)/auth/signin/page"
import ProPaymentPage from "@/app/(dashboard)/billing/pro/page"
import { BuyCreditRoute } from "@/app/(dashboard)/plan-usage/buy-credit/route-client"
import { middleware } from "@/middleware"

import { PlanBanner } from "./plan-banner"
const team = "use:11111111-1111-4111-8111-111111111111"
const otherTeam = "use:22222222-2222-4222-8222-222222222222"
const state = vi.hoisted(() => ({
  starterRecover: vi.fn(),
  recover: vi.fn(),
  start: vi.fn(),
  resume: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
  replace: vi.fn(),
  prepaid: vi.fn(),
  planReady: true,
  legacyPlan: false,
  originalTeamMember: true,
}))
vi.mock("@/lib/supabase/middleware", () => ({
  createMiddlewareClient: () => ({
    supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
    response: NextResponse.next(),
  }),
  matchesRoute: (path: string, routes: string[]) =>
    routes.some((route) => path === route || path.startsWith(`${route}/`)),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "different-signin-actor" } },
        error: null,
      }),
    },
  }),
}))
vi.mock("@/app/(auth)/auth/signin/google-action", () => ({
  beginGoogleSignIn: vi.fn(),
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ replace: state.replace }),
}))
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isError: false, isFetching: false }),
  useQueryClient: () => ({
    cancelQueries: async () => {},
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
  useTeamPlan: () => ({
    data: state.planReady
      ? state.legacyPlan
        ? null
        : { kind: "prepaid" }
      : undefined,
  }),
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
      teams: state.originalTeamMember
        ? [{ id: "22222222-2222-4222-8222-222222222222", region: "use" }]
        : [],
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
  recoverStarterCheckout: (...args: unknown[]) => state.starterRecover(...args),
}))
vi.mock("@/lib/api/plan-checkout", () => ({
  recoverProPayment: (...args: unknown[]) => state.recover(...args),
  startProCheckout: (...args: unknown[]) => state.start(...args),
  resumeProCheckout: (...args: unknown[]) => state.resume(...args),
  isStripeCheckoutUrl: () => false,
}))
beforeEach(() => {
  vi.clearAllMocks()
  state.starterRecover.mockResolvedValue({
    outcome: "no_pending_starter_checkout",
  })
  state.recover.mockResolvedValue("none")
  state.planReady = true
  state.legacyPlan = false
  state.originalTeamMember = true
  window.history.replaceState({}, "", "/")
})
async function renderPro(query: string, pathname = "/billing/pro/") {
  window.history.replaceState({}, "", `${pathname}?${query}`)
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
  it("consumes generic billing on buy-credit without erasing its purchase callback", () => {
    const query = `purchase=success&team=${team}&billing=success`
    window.history.replaceState({}, "", `/plan-usage/buy-credit/?${query}`)
    render(
      <>
        <PlanBanner />
        <BuyCreditRoute />
      </>,
    )
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(new URLSearchParams(window.location.search).toString()).toBe(
      new URLSearchParams(`purchase=success&team=${team}`).toString(),
    )
    expect(state.invalidate).toHaveBeenCalledOnce()
    expect(state.toast).toHaveBeenCalledOnce()
    expect(state.prepaid).toHaveBeenLastCalledWith(false)
  })
  it.each(["success", "cancel", "portal-return"])(
    "consumes generic %s billing on Pro without treating it as a Pro payment",
    async (result) => {
      await renderPro(`billing=${result}`)
      expect(window.location.search).toBe("")
      expect(screen.queryByText(/incomplete or invalid/)).toBeNull()
      expect(state.invalidate).toHaveBeenCalledOnce()
      expect(state.toast).toHaveBeenCalledOnce()
      expect(state.recover).not.toHaveBeenCalled()
      expect(state.start).not.toHaveBeenCalled()
    },
  )
  it.each(["success", "cancel", "portal-return"])(
    "consumes generic %s billing on buy-credit once and preserves unrelated parameters",
    (result) => {
      window.history.replaceState(
        {},
        "",
        `/plan-usage/buy-credit/?billing=${result}&amount=500&keep=1`,
      )
      const { rerender } = render(<PlanBanner />)
      expect(window.location.search).toBe("?amount=500&keep=1")
      expect(state.invalidate).toHaveBeenCalledOnce()
      expect(state.toast).toHaveBeenCalledOnce()
      rerender(<PlanBanner />)
      expect(state.invalidate).toHaveBeenCalledOnce()
      expect(state.toast).toHaveBeenCalledOnce()
      expect(state.start).not.toHaveBeenCalled()
    },
  )
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

describe("generic setup marker and strict checkout callback matrix", () => {
  it.each(["success", "cancel", "portal-return"])(
    "consumes generic %s from a team-pinned Pro entry without initiating payment recovery",
    async (flow) => {
      const view = await renderPro(`team=${team}&billing_flow=${flow}`)
      expect(new URLSearchParams(window.location.search).toString()).toBe(
        new URLSearchParams(`team=${team}`).toString(),
      )
      expect(screen.queryByText(/incomplete or invalid/)).toBeNull()
      view.rerender(<PlanBanner />)
      expect(state.toast).toHaveBeenCalledOnce()
      expect(state.invalidate).toHaveBeenCalledOnce()
      expect(state.recover).not.toHaveBeenCalled()
      expect(state.start).not.toHaveBeenCalled()
    },
  )
  it("removes a stale generic marker without consuming a true Pro result or recovering the wrong team", async () => {
    const remaining = `billing=success&team=${otherTeam}`
    const view = await renderPro(`${remaining}&billing_flow=portal-return`)
    expect(new URLSearchParams(window.location.search).toString()).toBe(
      new URLSearchParams(remaining).toString(),
    )
    view.rerender(
      <>
        <PlanBanner />
        {await ProPaymentPage({
          searchParams: Promise.resolve({
            billing: "success",
            team: otherTeam,
          }),
        })}
      </>,
    )
    expect(
      screen.getByRole("button", { name: "Return to checkout team" }),
    ).toBeTruthy()
    expect(new URLSearchParams(window.location.search).toString()).toBe(
      new URLSearchParams(remaining).toString(),
    )
    expect(state.recover).not.toHaveBeenCalled()
    expect(state.start).not.toHaveBeenCalled()
    expect(state.invalidate).toHaveBeenCalledOnce()
  })
  it("recovers a matching true Pro result only after its independent generic marker is consumed", async () => {
    const remaining = `billing=success&team=${team}`
    const view = await renderPro(`${remaining}&billing_flow=cancel`)
    expect(state.recover).not.toHaveBeenCalled()
    view.rerender(
      <>
        <PlanBanner />
        {await ProPaymentPage({
          searchParams: Promise.resolve({ billing: "success", team }),
        })}
      </>,
    )
    expect(new URLSearchParams(window.location.search).toString()).toBe(
      new URLSearchParams(remaining).toString(),
    )
    expect(state.recover).toHaveBeenCalledExactlyOnceWith(team)
    expect(state.start).not.toHaveBeenCalled()
    expect(state.toast).toHaveBeenCalledOnce()
  })
  it.each(["unknown", "success&billing_flow=cancel"])(
    "retains invalid or duplicate generic marker %s without downgrading strict recovery",
    async (flow) => {
      const query = `billing=success&team=${team}&billing_flow=${flow}`
      await renderPro(query)
      expect(window.location.search).toBe(`?${query}`)
      expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
      expect(state.recover).not.toHaveBeenCalled()
      expect(state.start).not.toHaveBeenCalled()
      expect(state.invalidate).not.toHaveBeenCalled()
    },
  )
  it("preserves malformed team context after consuming a generic setup marker", async () => {
    const view = await renderPro("team=malformed&billing_flow=success")
    expect(window.location.search).toBe("?team=malformed")
    view.rerender(
      <>
        <PlanBanner />
        {await ProPaymentPage({
          searchParams: Promise.resolve({ team: "malformed" }),
        })}
      </>,
    )
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(state.recover).not.toHaveBeenCalled()
    expect(state.start).not.toHaveBeenCalled()
  })
  it.each(["33333333-3333-4333-8333-333333333333", "malformed"])(
    "preserves purchase identity %s when consuming an independent generic marker",
    (purchaseId) => {
      const remaining = `purchase=cancel&team=${otherTeam}&purchase_id=${purchaseId}`
      window.history.replaceState(
        {},
        "",
        `/plan-usage/buy-credit/?${remaining}&billing_flow=success`,
      )
      const view = render(
        <>
          <PlanBanner />
          <BuyCreditRoute />
        </>,
      )
      expect(new URLSearchParams(window.location.search).toString()).toBe(
        new URLSearchParams(remaining).toString(),
      )
      view.rerender(
        <>
          <PlanBanner />
          <BuyCreditRoute />
        </>,
      )
      expect(new URLSearchParams(window.location.search).toString()).toBe(
        new URLSearchParams(remaining).toString(),
      )
      expect(state.prepaid).toHaveBeenLastCalledWith(false)
      expect(state.start).not.toHaveBeenCalled()
      if (purchaseId === "malformed")
        expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
      else
        expect(
          screen.getByRole("button", { name: "Return to checkout team" }),
        ).toBeTruthy()
      expect(state.invalidate).toHaveBeenCalledOnce()
    },
  )
})

it("consumes overlapping generic markers on buy-credit without stealing its purchase callback", () => {
  const purchaseId = "33333333-3333-4333-8333-333333333333"
  const remaining = `purchase=cancel&team=${otherTeam}&purchase_id=${purchaseId}`
  window.history.replaceState(
    {},
    "",
    `/plan-usage/buy-credit/?${remaining}&billing=success&billing_flow=portal-return`,
  )
  const view = render(
    <>
      <PlanBanner />
      <BuyCreditRoute />
    </>,
  )
  expect(new URLSearchParams(window.location.search).toString()).toBe(
    new URLSearchParams(remaining).toString(),
  )
  view.rerender(
    <>
      <PlanBanner />
      <BuyCreditRoute />
    </>,
  )
  expect(
    screen.getByRole("button", { name: "Return to checkout team" }),
  ).toBeTruthy()
  expect(state.invalidate).toHaveBeenCalledOnce()
  expect(state.toast).toHaveBeenCalledOnce()
  expect(state.start).not.toHaveBeenCalled()
})

it("consumes generic returns even while the current plan lookup is unavailable", async () => {
  state.planReady = false
  const view = await renderPro(`team=${team}&billing_flow=success`)
  expect(
    new URLSearchParams(window.location.search).get("billing_flow"),
  ).toBeNull()
  expect(new URLSearchParams(window.location.search).get("team")).toBe(team)
  expect(state.invalidate).toHaveBeenCalledOnce()
  view.rerender(<PlanBanner />)
  expect(state.invalidate).toHaveBeenCalledOnce()
  expect(state.recover).not.toHaveBeenCalled()
  expect(state.start).not.toHaveBeenCalled()
})

it.each(["billing=success", "billing_flow=portal-return"])(
  "consumes %s exactly once across the global and legacy banner consumers",
  async (query) => {
    state.legacyPlan = true
    const view = await renderPro(query)
    expect(window.location.search).toBe("")
    expect(state.invalidate).toHaveBeenCalledOnce()
    expect(state.toast).toHaveBeenCalledOnce()
    view.rerender(<PlanBanner />)
    expect(state.invalidate).toHaveBeenCalledOnce()
    expect(state.toast).toHaveBeenCalledOnce()
    expect(state.recover).not.toHaveBeenCalled()
    expect(state.start).not.toHaveBeenCalled()
  },
)

describe("expired generic checkout returns through middleware and sign-in", () => {
  it.each(["success", "cancel", "portal-return"])(
    "retains original team and purchase after %s with another account active",
    async (flow) => {
      const paths = [
        `/billing/pro/?team=${otherTeam}&return=%2Fsandboxes&billing_flow=${flow}`,
        `/billing/pro/?billing=success&team=${otherTeam}&billing_flow=${flow}`,
        `/plan-usage/buy-credit/?team=${otherTeam}&amount=500&billing_flow=${flow}`,
        `/plan-usage/buy-credit/?purchase=cancel&team=${otherTeam}&purchase_id=33333333-3333-4333-8333-333333333333&billing_flow=${flow}`,
      ]
      for (const path of paths.flatMap((path) => [path, path])) {
        state.originalTeamMember = !state.originalTeamMember
        const response = await middleware(
          new NextRequest(new URL(path, "https://console.test")),
        )
        const signin = new URL(response.headers.get("location")!)
        expect(signin.pathname.replace(/\/$/, "")).toBe("/auth/signin")
        expect(signin.searchParams.get("next")).toBe(path)
        window.history.replaceState({}, "", signin.pathname + signin.search)
        const replace = vi
          .spyOn(window.location, "replace")
          .mockImplementation(() => {})
        const signInView = render(<SignInPage />)
        await waitFor(() => expect(replace).toHaveBeenCalledWith(path))
        signInView.unmount()
        replace.mockRestore()
        let view
        if (path.startsWith("/billing/pro"))
          view = await renderPro(path.split("?")[1]!)
        else {
          window.history.replaceState({}, "", path)
          view = render(
            <>
              <PlanBanner />
              <BuyCreditRoute />
            </>,
          )
        }
        // Next navigation re-renders after the global consumer removes only
        // its generic marker. The retained team/purchase must still fence it.
        view.unmount()
        if (path.startsWith("/billing/pro"))
          view = await renderPro(window.location.search.slice(1))
        else
          view = render(
            <>
              <PlanBanner />
              <BuyCreditRoute />
            </>,
          )
        expect(new URLSearchParams(window.location.search).get("team")).toBe(
          otherTeam,
        )
        expect(state.start).not.toHaveBeenCalled()
        expect(state.resume).not.toHaveBeenCalled()
        expect(state.recover).not.toHaveBeenCalled()
        expect(screen.queryByText("$125")).toBeNull()
        if (state.originalTeamMember)
          expect(
            screen.getByRole("button", {
              name: /Return to (signup|checkout) team/,
            }),
          ).toBeTruthy()
        else
          expect(
            screen.queryByRole("button", {
              name: /Return to (signup|checkout) team/,
            }),
          ).toBeNull()
        expect(
          screen.getByRole("button", {
            name: /Sign out and use (signup|checkout) account/,
          }),
        ).toBeTruthy()
        view.unmount()
      }
    },
  )
})

it.each(["unknown", "success&billing_flow=cancel"])(
  "never opens an unpinned paid entry for invalid generic marker %s",
  async (flow) => {
    const pro = await renderPro(`billing_flow=${flow}`)
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(state.start).not.toHaveBeenCalled()
    pro.unmount()
    window.history.replaceState(
      {},
      "",
      `/plan-usage/buy-credit/?billing_flow=${flow}`,
    )
    render(
      <>
        <PlanBanner />
        <BuyCreditRoute />
      </>,
    )
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(state.prepaid).toHaveBeenLastCalledWith(false)
  },
)

it("renders bounded invalid-return error without propagating a raw malicious continuation", () => {
  window.history.replaceState({}, "", "/auth/auth-code-error/")
  render(<AuthCodeErrorPage />)
  expect(screen.getByText("Authentication Error")).toBeTruthy()
  expect(
    screen.getByRole("link", { name: "Try Again" }).getAttribute("href"),
  ).toBe("/auth/signin")
  expect(state.start).not.toHaveBeenCalled()
  expect(state.recover).not.toHaveBeenCalled()
})

it.each(["billing=unknown", "billing=success&billing=cancel"])(
  "preserves invalid Starter legacy markers through query synchronization: %s",
  (marker) => {
    const query = `team=${team}&${marker}`
    window.history.replaceState({}, "", `/plan-usage/buy-credit/?${query}`)
    const view = () => (
      <>
        <PlanBanner />
        <BuyCreditRoute />
      </>
    )
    const mounted = render(view())
    expect(window.location.search).toBe(`?${query}`)
    mounted.rerender(view())
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
    expect(state.toast).not.toHaveBeenCalled()
    expect(state.invalidate).not.toHaveBeenCalled()
    expect(state.prepaid).toHaveBeenLastCalledWith(false)
  },
)

it.each(["billing=unknown", "billing=success&billing=cancel"])(
  "generic setup does not erase another invalid Starter marker: %s",
  (marker) => {
    window.history.replaceState(
      {},
      "",
      `/plan-usage/buy-credit/?team=${team}&${marker}&billing_flow=success`,
    )
    const view = () => (
      <>
        <PlanBanner />
        <BuyCreditRoute />
      </>
    )
    const mounted = render(view())
    expect(
      new URLSearchParams(window.location.search).getAll("billing"),
    ).toEqual(new URLSearchParams(marker).getAll("billing"))
    expect(
      new URLSearchParams(window.location.search).has("billing_flow"),
    ).toBe(false)
    mounted.rerender(view())
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
  },
)

it.each([
  "billing=unknown",
  "billing=success&billing=cancel",
  "billing=unknown&billing_flow=success",
  "billing=success&billing=cancel&billing_flow=success",
])("fences teamless invalid Starter legacy returns: %s", (query) => {
  window.history.replaceState({}, "", `/plan-usage/buy-credit/?${query}`)
  const view = () => (
    <>
      <PlanBanner />
      <BuyCreditRoute />
    </>
  )
  const mounted = render(view())
  mounted.rerender(view())
  expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
  expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
  expect(state.prepaid).toHaveBeenLastCalledWith(false)
  expect(new URLSearchParams(window.location.search).getAll("billing")).toEqual(
    new URLSearchParams(query).getAll("billing"),
  )
})

vi.mock("@/lib/api/prepaid", async (original) => ({
  ...(await original<typeof import("@/lib/api/prepaid")>()),
  startPrepaidCheckout: (...args: unknown[]) => state.start(...args),
}))

const invalidReturnMatrix = ["/billing/pro", "/plan-usage/buy-credit"].flatMap(
  (route) =>
    ["", "/"].flatMap((slash) =>
      ["", `team=${team}&`].flatMap((identity) =>
        [
          "purchase=unknown",
          "purchase=",
          "purchase=success&purchase=success",
          "purchase=success&purchase=cancel",
          "purchase_id=33333333-3333-4333-8333-333333333333&purchase_id=33333333-3333-4333-8333-333333333333",
          "purchase_id=not-an-id&unsupported=1",
          "billing=unknown",
          "billing=",
          "billing=success&billing=success",
          "billing=success&billing=cancel",
          "billing_flow=unknown",
          "billing_flow=",
          "billing_flow=success&billing_flow=success",
          "billing_flow=success&billing_flow=cancel",
          "billing=unknown&billing_flow=success",
          "billing=success&billing_flow=unknown",
        ].map((marker) => `${route}${slash}?${identity}${marker}`),
      ),
    ),
)

it.each(invalidReturnMatrix)(
  "rejects invalid return across middleware and sign-in: %s",
  async (path) => {
    const response = await middleware(
      new NextRequest(new URL(path, "https://console.test")),
    )
    const signin = new URL(response.headers.get("location")!)
    expect(signin.pathname.replace(/\/$/, "")).toBe("/auth/signin")
    expect(signin.searchParams.get("next")).toBe("/auth/auth-code-error/")
    window.history.replaceState({}, "", signin.pathname + signin.search)
    const replace = vi
      .spyOn(window.location, "replace")
      .mockImplementation(() => {})
    const auth = render(<SignInPage />)
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/auth/auth-code-error/"),
    )
    auth.unmount()
    replace.mockRestore()
    const errorResponse = await middleware(
      new NextRequest("https://console.test/auth/auth-code-error/"),
    )
    expect(errorResponse.headers.get("location")).toBeNull()
    window.history.replaceState({}, "", "/auth/auth-code-error/")
    render(<AuthCodeErrorPage />)
    expect(screen.getByText("Authentication Error")).toBeTruthy()
    expect(state.start).not.toHaveBeenCalled()
    expect(state.resume).not.toHaveBeenCalled()
    expect(state.recover).not.toHaveBeenCalled()
    expect(state.starterRecover).not.toHaveBeenCalled()
  },
)

it.each(invalidReturnMatrix)(
  "keeps signed-in invalid return fenced after banner/query synchronization: %s",
  async (path) => {
    const url = new URL(path, "https://console.test")
    const mount = async () => {
      if (url.pathname.startsWith("/billing/pro"))
        return renderPro(window.location.search.slice(1), url.pathname)
      return render(
        <>
          <PlanBanner />
          <BuyCreditRoute />
        </>,
      )
    }
    window.history.replaceState({}, "", path)
    const first = await mount()
    first.unmount()
    await mount()
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(
      screen.queryByRole("button", {
        name: /Buy .* credit|Continue to payment/,
      }),
    ).toBeNull()
    expect(state.start).not.toHaveBeenCalled()
    expect(state.resume).not.toHaveBeenCalled()
    expect(state.recover).not.toHaveBeenCalled()
    expect(state.starterRecover).not.toHaveBeenCalled()
    if (url.pathname.startsWith("/plan-usage"))
      expect(state.prepaid).toHaveBeenLastCalledWith(false)
  },
)

it.each([
  "/billing/pro",
  "/billing/pro/",
  "/plan-usage/buy-credit",
  "/plan-usage/buy-credit/",
])("preserves deliberate bare entry through sign-in: %s", async (path) => {
  const response = await middleware(
    new NextRequest(new URL(path, "https://console.test")),
  )
  const signin = new URL(response.headers.get("location")!)
  expect(signin.searchParams.get("next")).toBe(path)
  window.history.replaceState({}, "", signin.pathname + signin.search)
  const replace = vi
    .spyOn(window.location, "replace")
    .mockImplementation(() => {})
  render(<SignInPage />)
  await waitFor(() => expect(replace).toHaveBeenCalledWith(path))
  replace.mockRestore()
  expect(state.start).not.toHaveBeenCalled()
  expect(state.resume).not.toHaveBeenCalled()
  expect(state.recover).not.toHaveBeenCalled()
  expect(state.starterRecover).not.toHaveBeenCalled()
})

it.each(["/plan-usage/buy-credit", "/plan-usage/buy-credit/"])(
  "retains accepted malformed operation evidence for downstream rejection: %s",
  async (route) => {
    const path = `${route}?team=${team}&purchase_id=not-an-id`
    const response = await middleware(
      new NextRequest(new URL(path, "https://console.test")),
    )
    const signin = new URL(response.headers.get("location")!)
    expect(signin.searchParams.get("next")).toBe(path)
    window.history.replaceState({}, "", path)
    render(
      <>
        <PlanBanner />
        <BuyCreditRoute />
      </>,
    )
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(new URLSearchParams(window.location.search).get("purchase_id")).toBe(
      "not-an-id",
    )
    expect(state.start).not.toHaveBeenCalled()
    expect(state.starterRecover).not.toHaveBeenCalled()
  },
)
