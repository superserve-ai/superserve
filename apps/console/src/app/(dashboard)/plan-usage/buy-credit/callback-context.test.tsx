vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({
    isPending: state.capabilitiesPending,
    data: state.capabilitiesMissing
      ? undefined
      : {
          fresh_entry: { starter: false, auto_recharge: false },
          actions: {
            disable_auto_recharge: state.disableRecharge,
            recover_payment: state.allowRecovery,
          },
        },
  }),
}))
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { BuyCreditPageClient } from "./page-client"
import { BuyCreditRoute } from "./route-client"
const state = vi.hoisted(() => ({
  recover: vi.fn(),
  allowRecovery: true,
  disableRecharge: true,
  capabilitiesPending: false,
  capabilitiesMissing: false,
  rechargeEnabled: false,
  ready: true,
  team: "use:11111111-1111-4111-8111-111111111111",
  query: "",
  prepaid: vi.fn(),
  retained: [] as { id: string; amount: number }[],
  summary: vi.fn(),
  switch: vi.fn(),
  directoryError: false,
  pricing: "legacy" as "legacy" | "v2" | undefined | null,
  refetch: vi.fn(),
}))
vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: (...args: unknown[]) => state.recover(...args),
}))
vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersion: () => state.pricing,
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({ ready: state.ready, teamKey: state.team }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "actor" } }),
}))
vi.mock("@/components/query-provider", () => ({ useQueryScope: () => "self" }))
vi.mock("@/components/page-header", () => ({
  PageHeader: () => <h1>Buy credit</h1>,
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: (enabled: boolean) => {
    state.summary(enabled)
    return { data: { permissions: { can_manage: true } } }
  },
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: (enabled: boolean) => {
    state.prepaid(enabled)
    return {
      data: {
        checkout_idempotency_supported: true,
        balance_cents: 12500,
        purchases: [],
        auto_recharge: { enabled: state.rechargeEnabled },
      },
    }
  },
  useRetainedPrepaidOperations: () => state.retained,
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: state.directoryError
      ? undefined
      : {
          teams: [
            { id: "22222222-2222-4222-8222-222222222222", region: "usw" },
          ],
        },
    isError: state.directoryError,
    refetch: state.refetch,
  }),
  useSwitchTeam: () => ({ mutateAsync: state.switch }),
}))
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ isMutating: () => 0 }),
  useIsMutating: () => 0,
}))
beforeEach(() => {
  state.recover
    .mockReset()
    .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
  state.allowRecovery = true
  state.disableRecharge = true
  state.capabilitiesPending = false
  state.capabilitiesMissing = false
  state.rechargeEnabled = false
  state.pricing = "legacy"
  state.retained = []
  state.ready = true
  state.team = "use:11111111-1111-4111-8111-111111111111"
  state.prepaid.mockClear()
  state.summary.mockClear()
  state.directoryError = false
  state.switch.mockReset()
})
describe("Starter callback context isolation", () => {
  it.each(["success", "cancel"])(
    "keeps %s callback intact without displaying other team credit or allowing purchases",
    (status) => {
      state.query = `purchase=${status}&team=usw:22222222-2222-4222-8222-222222222222&purchase_id=33333333-3333-4333-8333-333333333333`
      render(<BuyCreditPageClient />)
      expect(
        screen.getByRole("button", { name: "Return to checkout team" }),
      ).toBeTruthy()
      expect(screen.queryByText("$125")).toBeNull()
      expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
      expect(state.prepaid).toHaveBeenLastCalledWith(false)
      expect(state.summary).toHaveBeenLastCalledWith(false)
    },
  )
  it("waits for team context before claiming a mismatch or checking payment", () => {
    state.ready = false
    state.query =
      "purchase=success&team=usw:22222222-2222-4222-8222-222222222222"
    render(<BuyCreditPageClient />)
    expect(screen.queryByText(/Return to the account and team/)).toBeNull()
    expect(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    ).toBeTruthy()
    expect(screen.queryByText(/Checking payment status/)).toBeNull()
    expect(screen.queryByText("$125")).toBeNull()
    expect(state.prepaid).toHaveBeenLastCalledWith(false)
  })
  it("rejects a callback with conflicting teams even when the first team matches", () => {
    state.query = `purchase=success&team=${state.team}&team=usw:22222222-2222-4222-8222-222222222222`
    render(<BuyCreditPageClient />)
    expect(screen.getByText(/incomplete or invalid/)).toBeTruthy()
    expect(state.prepaid).toHaveBeenLastCalledWith(false)
  })
  it("retains a failed team-switch error through pending context and permits retry", async () => {
    state.query =
      "purchase=success&team=usw:22222222-2222-4222-8222-222222222222"
    let reject!: (error: Error) => void
    state.switch.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const view = render(<BuyCreditPageClient />)
    fireEvent.click(
      screen.getByRole("button", { name: "Return to checkout team" }),
    )
    state.ready = false
    view.rerender(<BuyCreditPageClient />)
    expect(state.prepaid).toHaveBeenLastCalledWith(false)
    state.ready = true
    view.rerender(<BuyCreditPageClient />)
    await act(async () => reject(new Error("not a member")))
    expect(
      screen.getByText("Unable to restore checkout. Please try again."),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Return to checkout team" }),
    )
    expect(state.switch).toHaveBeenCalledTimes(2)
  })
  it("keeps recovery reachable after directory failure without a resolved team", () => {
    state.query =
      "purchase=success&team=usw:22222222-2222-4222-8222-222222222222"
    state.ready = false
    state.directoryError = true
    render(<BuyCreditPageClient />)
    expect(
      screen.getByRole("button", { name: "Retry team lookup" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Sign out and use checkout account" }),
    ).toBeTruthy()
    expect(state.prepaid).toHaveBeenLastCalledWith(false)
  })
  it.each(["legacy", undefined, null] as const)(
    "exposes callback recovery before current-team pricing gate %s",
    (pricing) => {
      state.pricing = pricing
      state.query =
        "purchase=success&team=usw:22222222-2222-4222-8222-222222222222"
      state.ready = pricing === "legacy"
      render(<BuyCreditRoute />)
      expect(
        screen.getByRole("button", {
          name: "Sign out and use checkout account",
        }),
      ).toBeTruthy()
      expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
      expect(state.prepaid).toHaveBeenLastCalledWith(false)
    },
  )
  it("restores only existing purchase recovery when the original team's entry is closed", async () => {
    state.pricing = "legacy"
    state.query = `purchase=success&team=${state.team}&purchase_id=33333333-3333-4333-8333-333333333333`
    state.retained = [
      { id: "33333333-3333-4333-8333-333333333333", amount: 500 },
    ]
    render(<BuyCreditRoute />)
    expect(screen.getByText("$125")).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: "Check previous purchase" }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
    expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true")
  })
})

it.each([
  [false, true],
  [true, false],
  [false, false],
  [true, true],
])(
  "describes credit entry=%s and recharge entry=%s independently",
  (allowEntry, allowRecharge) => {
    state.query = ""
    render(
      <BuyCreditPageClient
        allowEntry={allowEntry}
        allowRecharge={allowRecharge}
      />,
    )
    expect(
      Boolean(
        screen.queryByText("Credit purchases are temporarily unavailable."),
      ),
    ).toBe(!allowEntry)
    expect(
      Boolean(
        screen.queryByText(/Auto-recharge changes are temporarily unavailable/),
      ),
    ).toBe(!allowRecharge)
  },
)

it.each([false, true, undefined])(
  "routes recharge disable admission independently: %s",
  (allowed) => {
    state.query = ""
    state.pricing = "v2"
    state.rechargeEnabled = true
    state.capabilitiesMissing = allowed === undefined
    state.disableRecharge = allowed ?? true
    render(<BuyCreditRoute />)
    const toggle = screen.getByRole("switch")
    expect(toggle.getAttribute("aria-disabled") === "true").toBe(
      allowed === false,
    )
  },
)

it.each([false, true, undefined])(
  "routes Starter recovery admission independently: %s",
  async (allowed) => {
    state.query = ""
    state.pricing = "v2"
    state.allowRecovery = allowed ?? true
    state.capabilitiesMissing = allowed === undefined
    render(<BuyCreditRoute />)
    await act(async () => {})
    expect(state.recover.mock.calls.length > 0).toBe(allowed !== false)
  },
)

it("waits for initial capabilities before retained Starter recovery or recharge disable", async () => {
  state.query = ""
  state.pricing = "v2"
  state.rechargeEnabled = true
  state.capabilitiesPending = true
  state.capabilitiesMissing = true
  const mounted = render(<BuyCreditRoute />)
  await act(async () => {})
  expect(state.recover).not.toHaveBeenCalled()
  expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true")
  state.capabilitiesPending = false
  mounted.rerender(<BuyCreditRoute />)
  await act(async () => {})
  expect(state.recover).toHaveBeenCalled()
  expect(screen.getByRole("switch")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  )
})
