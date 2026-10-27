import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PrepaidCreditSummary } from "@/lib/api/prepaid"

const mocks = vi.hoisted(() => ({
  data: null as PrepaidCreditSummary | null,
  save: vi.fn(),
  recover: vi.fn(),
  params: new URLSearchParams(),
  checkout: vi.fn(),
  operations: [] as {
    id: string
    amount: number
    team: string
    actor: string
    success: string
    cancel: string
  }[],
  teamKey: "use:11111111-1111-4111-8111-111111111111",
  ready: true,
  scope: "self",
}))

vi.mock("@/lib/api/starter-checkout-recovery", () => ({
  recoverStarterCheckout: (...args: unknown[]) => mocks.recover(...args),
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({ data: { teams: [] } }),
  useSwitchTeam: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.params,
}))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => mocks.scope,
}))
vi.mock("@/components/page-header", () => ({ PageHeader: () => null }))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    teamKey: mocks.teamKey,
    cacheScope: mocks.scope,
    ready: mocks.ready,
  }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "actor" } }),
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({ data: { permissions: { can_manage: true } } }),
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: () => ({ data: mocks.data, isLoading: false, error: null }),
  useRetainedPrepaidOperations: () => mocks.operations,
}))
vi.mock("@/lib/api/prepaid", async (original) => ({
  ...(await original<typeof import("@/lib/api/prepaid")>()),
  setPrepaidAutoRecharge: mocks.save,
  startPrepaidCheckout: mocks.checkout,
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))

import { BuyCreditPageClient } from "./page-client"

const initial: PrepaidCreditSummary = {
  checkout_idempotency_supported: true,
  balance_cents: 2500,
  low_balance: false,
  has_saved_card: true,
  purchases: [],
  auto_recharge: {
    enabled: true,
    threshold_cents: 1000,
    amount_cents: 2500,
    disabled_reason: null,
    disabled_at: null,
    in_flight: false,
  },
}

beforeEach(() => {
  mocks.params = new URLSearchParams()
  mocks.teamKey = "use:11111111-1111-4111-8111-111111111111"
  mocks.scope = "self"
  mocks.ready = true
  mocks.recover
    .mockReset()
    .mockResolvedValue({ outcome: "no_pending_starter_checkout" })
  mocks.checkout.mockReset()
  mocks.operations = []
  mocks.data = initial
})
function page() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <BuyCreditPageClient />
    </QueryClientProvider>
  )
}
it("blocks checkout before calling a backend without durable retry support", () => {
  mocks.data = { ...initial, checkout_idempotency_supported: undefined }
  render(page())
  const buy = screen.getByRole("button", { name: "Buy $25 credit" })
  expect(buy).toBeDisabled()
  fireEvent.click(buy)
  expect(mocks.checkout).not.toHaveBeenCalled()
  expect(
    screen.getByText(/Credit purchases are temporarily unavailable/),
  ).toBeTruthy()
})
it("keeps return URLs as navigation and never claims a verified payment", () => {
  mocks.params = new URLSearchParams(
    "purchase=success&team=use%3A11111111-1111-4111-8111-111111111111",
  )
  render(page())
  expect(screen.getByText(/Checking payment status/)).toBeTruthy()
  expect(screen.queryByText(/Payment received/)).toBeNull()
})
it("doesn't show another team's credit or purchase controls after a payment return", () => {
  mocks.params = new URLSearchParams(
    "purchase=success&team=use%3A22222222-2222-4222-8222-222222222222",
  )
  render(page())
  expect(screen.getByRole("alert").textContent).toContain(
    "account and team that started checkout",
  )
  expect(screen.queryByRole("button", { name: /Buy.*credit/ })).toBeNull()
  expect(screen.queryByText("Credit balance")).toBeNull()
})
it("keeps impersonation read only", () => {
  mocks.scope = "team-other"
  render(page())
  expect(screen.getByRole("button", { name: "Buy $25 credit" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
})
it("recovers the retained purchase after a lost response and entry closes", async () => {
  mocks.checkout.mockRejectedValueOnce(new Error("lost response"))
  const view = (allowEntry: boolean) => (
    <QueryClientProvider client={new QueryClient()}>
      <BuyCreditPageClient allowEntry={allowEntry} />
    </QueryClientProvider>
  )
  const { rerender } = render(view(true))
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Buy $25 credit" }),
    ).not.toBeDisabled(),
  )
  fireEvent.click(screen.getByRole("button", { name: "Buy $25 credit" }))
  await waitFor(() =>
    expect(screen.getByText(/Payment status is uncertain/)).toBeTruthy(),
  )
  mocks.operations = [
    {
      id: "retained",
      amount: 2500,
      actor: "actor",
      team: "use:11111111-1111-4111-8111-111111111111",
      success: "original-success",
      cancel: "original-cancel",
    },
  ]
  mocks.checkout.mockResolvedValue({
    purchase_id: "retained",
    state: "pending",
  })
  rerender(view(false))
  expect(screen.queryByRole("button", { name: /Buy.*credit/ })).toBeNull()
  fireEvent.click(
    screen.getByRole("button", { name: "Check previous purchase" }),
  )
  await waitFor(() =>
    expect(mocks.checkout).toHaveBeenLastCalledWith(
      "use:11111111-1111-4111-8111-111111111111",
      2500,
      expect.any(String),
      "actor",
      "retained",
    ),
  )
})

it("serializes duplicate clicks and ignores checkout results after a team switch", async () => {
  let finish!: (value: {
    purchase_id: string
    state: string
    url: string
  }) => void
  mocks.checkout.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const assign = vi
    .spyOn(window.location, "assign")
    .mockImplementation(() => {})
  const { rerender } = render(page())
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Buy $25 credit" }),
    ).not.toBeDisabled(),
  )
  const buy = screen.getByRole("button", { name: "Buy $25 credit" })
  fireEvent.click(buy)
  fireEvent.click(buy)
  expect(mocks.checkout).toHaveBeenCalledTimes(1)
  expect(mocks.checkout).toHaveBeenCalledWith(
    "use:11111111-1111-4111-8111-111111111111",
    2500,
    expect.any(String),
    "actor",
    undefined,
  )
  mocks.teamKey = "us:other"
  rerender(page())
  finish({
    purchase_id: "purchase",
    state: "pending",
    url: "https://checkout.stripe.com/original",
  })
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Buy $25 credit" }),
    ).toBeEnabled(),
  )
  expect(assign).not.toHaveBeenCalled()
  assign.mockRestore()
})

describe("auto-recharge refresh", () => {
  it("reflects a remote disable before saving again", async () => {
    mocks.data = initial
    const client = new QueryClient()
    const page = () => (
      <QueryClientProvider client={client}>
        <BuyCreditPageClient />
      </QueryClientProvider>
    )
    const { rerender } = render(page())
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true")
    mocks.data = {
      ...initial,
      auto_recharge: {
        ...initial.auto_recharge,
        enabled: false,
        disabled_reason: "card declined",
        disabled_at: "2026-10-23T00:00:00Z",
      },
    }
    mocks.save.mockResolvedValue(mocks.data)
    rerender(page())
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    )
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        "use:11111111-1111-4111-8111-111111111111",
        {
          enabled: false,
          thresholdCents: 1000,
          amountCents: 2500,
        },
      ),
    )
  })
})

describe("auto-recharge rollback", () => {
  it("permits disabling while closing all new commitments", async () => {
    mocks.save.mockReset()
    mocks.data = initial
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <BuyCreditPageClient allowEntry={false} />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole("button", { name: /Buy .* credit/ })).toBeNull()
    expect(screen.getByText("$25")).toBeTruthy()
    expect(screen.queryByText(/never expires/)).toBeNull()
    expect(screen.queryByText(/pause sandboxes at/)).toBeNull()
    for (const input of screen.getAllByRole("textbox"))
      expect(input.hasAttribute("disabled")).toBe(true)
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true)
    mocks.save.mockResolvedValue({
      ...initial,
      auto_recharge: { ...initial.auto_recharge, enabled: false },
    })
    fireEvent.click(screen.getByRole("switch"))
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    )
    fireEvent.click(screen.getByRole("switch"))
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    )
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        "use:11111111-1111-4111-8111-111111111111",
        {
          enabled: false,
          thresholdCents: 1000,
          amountCents: 2500,
        },
      ),
    )
  })
})

it.each([false, true])(
  "discovers an original $5 checkout with empty storage, ordinary callback=%s",
  async (callback) => {
    sessionStorage.clear()
    const original = {
      outcome: "pending_starter_checkout",
      purchase_id: "33333333-3333-4333-8333-333333333333",
      checkout_generation: "2026-10-27T00:00:00Z",
      amount_cents: 500,
    }
    mocks.recover.mockResolvedValue(original)
    if (callback)
      mocks.params = new URLSearchParams({
        purchase: "cancel",
        team: mocks.teamKey,
        purchase_id: original.purchase_id,
      })
    render(page())
    await screen.findByRole("button", {
      name: "Resume your $5 credit purchase",
    })
    expect(
      screen.getByRole("button", { name: "Cancel this unpaid purchase" }),
    ).not.toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Buy $25 credit" }),
    ).toBeDisabled()
    expect(mocks.checkout).not.toHaveBeenCalled()
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(mocks.teamKey)
    expect(sessionStorage.length).toBe(0)
  },
)

it("does not start a different purchase while server discovery is unresolved or forbidden", async () => {
  let reject!: (error: Error) => void
  mocks.recover.mockImplementation(
    () =>
      new Promise((_resolve, failure) => {
        reject = failure
      }),
  )
  render(page())
  const buy = screen.getByRole("button", { name: "Buy $25 credit" })
  expect(buy).toBeDisabled()
  fireEvent.click(buy)
  expect(mocks.checkout).not.toHaveBeenCalled()
  reject(new Error("403"))
  await screen.findByText(/Unable to check your existing purchase/)
  expect(buy).toBeDisabled()
  expect(
    screen.getByRole("button", { name: "Check purchase status" }),
  ).not.toBeDisabled()
  expect(mocks.checkout).not.toHaveBeenCalled()
})

it("honors an explicit recharge-disable denial including a mid-edit change", () => {
  mocks.save.mockReset()
  const client = new QueryClient()
  const view = (allowDisableRecharge: boolean) => (
    <QueryClientProvider client={client}>
      <BuyCreditPageClient
        allowEntry={false}
        allowDisableRecharge={allowDisableRecharge}
      />
    </QueryClientProvider>
  )
  const mounted = render(view(false))
  expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true")
  fireEvent.click(screen.getByRole("switch"))
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true")
  mounted.rerender(view(true))
  fireEvent.click(screen.getByRole("switch"))
  expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled()
  mounted.rerender(view(false))
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  expect(mocks.save).not.toHaveBeenCalled()
})

it("denies Starter discovery and retained purchase writes on explicit recovery denial", () => {
  mocks.recover.mockClear()
  mocks.checkout.mockClear()
  mocks.operations = [
    {
      id: "saved",
      amount: 2500,
      team: mocks.teamKey,
      actor: "actor",
      success: "/saved",
      cancel: "/saved",
    },
  ]
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BuyCreditPageClient allowEntry={false} allowRecovery={false} />
    </QueryClientProvider>,
  )
  const retained = screen.getByRole("button", {
    name: "Check previous purchase",
  })
  expect(retained).toBeDisabled()
  fireEvent.click(retained)
  expect(mocks.recover).not.toHaveBeenCalled()
  expect(mocks.checkout).not.toHaveBeenCalled()
  expect(screen.getByText("$25")).toBeTruthy()
})

it("keeps fresh Starter entry fenced when recovery discovery is explicitly denied", () => {
  mocks.checkout.mockClear()
  mocks.recover.mockClear()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BuyCreditPageClient allowEntry allowRecovery={false} />
    </QueryClientProvider>,
  )
  const buy = screen.getByRole("button", { name: "Buy $25 credit" })
  expect(buy).toBeDisabled()
  fireEvent.click(buy)
  expect(mocks.checkout).not.toHaveBeenCalled()
  expect(mocks.recover).not.toHaveBeenCalled()
})
