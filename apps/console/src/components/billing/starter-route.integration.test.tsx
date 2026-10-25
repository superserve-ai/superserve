import { existsSync } from "node:fs"
import { resolve } from "node:path"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import BuyCreditPage from "@/app/(dashboard)/plan-usage/buy-credit/page"
import type { TeamPlan } from "@/lib/api/billing-v2"

import { PlanAwareBanner } from "./plan-aware-banner"

vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersion: () => "v2",
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({ teamKey: "use:team-a", ready: true }),
}))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: () => ({
    data: { permissions: { can_view: true, can_manage: true } },
  }),
}))
vi.mock("@/hooks/use-prepaid-credit", () => ({
  usePrepaidCredit: () => ({
    data: {
      balance_cents: 0,
      has_saved_card: false,
      auto_recharge: { enabled: false },
      purchases: [],
    },
    isLoading: false,
  }),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@superserve/ui", async (original) => ({
  ...(await original<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))

it("serves the rendered Starter recovery links with the real purchase page", () => {
  const plan: TeamPlan = {
    key: "starter",
    kind: "prepaid",
    name: "Starter",
    limits: {
      max_concurrent: 100,
      max_vcpu: 2,
      max_memory_mib: 4096,
      max_disk_mib: 51200,
      max_templates: 10,
    },
    fee_cents: null,
    included_cents: null,
    period_start: null,
    period_end: null,
    pending_change: null,
  }
  const banner = render(
    <PlanAwareBanner
      plan={plan}
      prepaid={{
        balance_cents: 0,
        auto_recharge: {
          enabled: false,
          threshold_cents: null,
          amount_cents: null,
          disabled_reason: null,
          disabled_at: null,
          in_flight: false,
        },
      }}
      canManage
    />,
  )
  for (const name of ["Buy credit", "Set up auto-recharge"]) {
    const href = screen.getByRole("link", { name }).getAttribute("href")
    expect(href).toBe("/plan-usage/buy-credit")
    expect(
      existsSync(resolve(process.cwd(), `src/app/(dashboard)${href}/page.tsx`)),
    ).toBe(true)
  }
  banner.unmount()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BuyCreditPage />
    </QueryClientProvider>,
  )
  expect(screen.getByRole("heading", { name: "Buy credit" })).toBeTruthy()
  expect(screen.getByText("Credit balance")).toBeTruthy()
})
