vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({
    data: {
      pricing_version: mocks.version(),
      entry_open: mocks.version() === "v2",
      fresh_entry: {
        starter: mocks.version() === "v2",
        pro: mocks.version() === "v2",
        choose_free: mocks.version() === "v2",
      },
    },
  }),
}))
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CatalogPlan, TeamPlan } from "@/lib/api/billing-v2"

const mocks = vi.hoisted(() => ({
  version: vi.fn(),
  catalog: vi.fn(),
  plan: vi.fn(),
  summary: vi.fn(),
  replace: vi.fn(),
  preview: vi.fn(),
  schedule: vi.fn(),
  undo: vi.fn(),
  toast: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock("@superserve/ui", async () => ({
  ...(await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")),
  useToast: () => ({ addToast: mocks.toast }),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    cacheScope: "self",
    teamKey: "use:team-a",
    ready: true,
  }),
}))
vi.mock("@/hooks/use-pricing-version", () => ({
  usePricingVersionState: mocks.version,
  useCatalogPlans: mocks.catalog,
}))
vi.mock("@/hooks/use-billing-v2", () => ({ useTeamPlan: mocks.plan }))
vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingSummary: mocks.summary,
}))
vi.mock("@/lib/api/plan-changes", () => ({
  previewPlanChange: mocks.preview,
  schedulePlanChange: mocks.schedule,
  undoPlanChange: mocks.undo,
}))

import { UpgradePage } from "./upgrade-page"

const freeLimits = {
  max_concurrent: 1,
  max_vcpu: 1,
  max_memory_mib: 1024,
  max_disk_mib: 4096,
  max_templates: null,
}
const proLimits = {
  max_concurrent: 1000,
  max_vcpu: 8,
  max_memory_mib: 32768,
  max_disk_mib: 102400,
  max_templates: null,
}
const catalog: CatalogPlan[] = [
  {
    key: "free",
    family: "free",
    kind: "free",
    name: "Free",
    price_label: "$0",
    available: true,
    fee_cents: 0,
    included_cents: null,
    limits: freeLimits,
    funding_policy: "postpaid",
  },
  {
    key: "starter",
    family: "starter",
    kind: "prepaid",
    name: "Starter",
    price_label: "Prepaid credit from $5",
    available: true,
    fee_cents: null,
    included_cents: null,
    limits: freeLimits,
    funding_policy: "prepaid",
  },
  {
    key: "pro_monthly",
    family: "pro",
    kind: "subscription",
    name: "Pro",
    price_label: "$250/month",
    available: true,
    fee_cents: 25000,
    included_cents: 25000,
    limits: proLimits,
    funding_policy: "postpaid",
  },
  {
    key: "enterprise",
    family: "enterprise",
    kind: "custom",
    name: "Enterprise",
    price_label: "Book a meeting",
    available: true,
    fee_cents: null,
    included_cents: null,
    limits: {
      max_concurrent: null,
      max_vcpu: null,
      max_memory_mib: null,
      max_disk_mib: null,
      max_templates: null,
    },
    funding_policy: "postpaid",
  },
]
const pro: TeamPlan = {
  key: "pro_monthly",
  kind: "subscription",
  name: "Pro",
  limits: proLimits,
  fee_cents: 25000,
  included_cents: 25000,
  period_start: "2026-10-01T00:00:00Z",
  effective_from: "2026-10-01T00:00:00Z",
  period_end: "2026-11-01T00:00:00Z",
  pending_change: null,
}

function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UpgradePage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.version.mockReturnValue("v2")
  mocks.catalog.mockReturnValue({ data: catalog })
  mocks.plan.mockReturnValue({ data: pro, isError: false })
  mocks.summary.mockReturnValue({
    data: { permissions: { can_view: true, can_manage: true } },
  })
})

describe("UpgradePage with pricing v2 off", () => {
  it.each(["subscription", "prepaid", "custom"] as const)(
    "keeps %s visible without starting a new transition while admission is closed",
    async (kind) => {
      mocks.version.mockReturnValue("legacy")
      mocks.plan.mockReturnValue({ data: { ...pro, kind }, isError: false })
      mount()
      expect(
        screen.queryByRole("button", { name: "Switch to Free" }),
      ).toBeNull()
      expect(screen.queryByRole("link", { name: /Get |Book/ })).toBeNull()
      expect(screen.queryByTestId("plan-card-pro_monthly")).toBeNull()
      expect(mocks.replace).not.toHaveBeenCalled()
    },
  )

  it("keeps undo available after rollback", async () => {
    mocks.version.mockReturnValue("legacy")
    mocks.plan.mockReturnValue({
      data: {
        ...pro,
        pending_change: {
          id: "34971786-dd50-492b-b934-306b63764c4b",
          plan_key: "free",
          plan_name: "Free",
          effective_at: "2026-11-01T00:00:00Z",
          undoable: true,
          pauses_running: true,
        },
      },
      isError: false,
    })
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Undo change" }))
    await waitFor(() =>
      expect(mocks.undo).toHaveBeenCalledWith(
        "34971786-dd50-492b-b934-306b63764c4b",
        "use:team-a",
      ),
    )
    expect(screen.queryByRole("button", { name: "Switch to Free" })).toBeNull()
  })

  it("waits without redirecting while the switch hasn't answered", () => {
    mocks.version.mockReturnValue("unknown")
    const { container } = mount()
    expect(container.textContent).toContain("New purchases are unavailable")
    expect(screen.queryByRole("button", { name: "Switch to Free" })).toBeNull()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.plan).toHaveBeenCalledWith(true)
  })

  it("sends unassigned people back to the billing page", () => {
    mocks.version.mockReturnValue("legacy")
    mocks.plan.mockReturnValue({ data: null, isError: false })
    const { container } = mount()
    expect(container.textContent).toBe("")
    expect(mocks.replace).toHaveBeenCalledWith("/plan-usage")
    expect(mocks.plan).toHaveBeenCalledWith(true)
  })
})

describe("UpgradePage with pricing v2 on", () => {
  it("shows every plan with the right action for a Pro team", () => {
    mount()
    expect(screen.getByTestId("plan-card-pro_monthly").textContent).toMatch(
      /Current plan/,
    )
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull()
    expect(screen.queryByTestId("plan-card-free")).toBeNull()
    expect(screen.queryByTestId("plan-card-starter")).toBeNull()
    expect(screen.getByRole("link", { name: "Book a meeting" })).toBeTruthy()
  })

  it("shows a scheduled downgrade and undoes it", async () => {
    mocks.plan.mockReturnValue({
      data: {
        ...pro,
        pending_change: {
          id: "34971786-dd50-492b-b934-306b63764c4b",
          pauses_running: true,
          plan_key: "free",
          plan_name: "Free",
          effective_at: "2026-11-01T00:00:00Z",
          undoable: true,
        },
      },
      isError: false,
    })
    mocks.undo.mockResolvedValue(undefined)
    mount()
    expect(
      screen.getByRole("status", { name: "Scheduled plan change" }).textContent,
    ).toMatch(/from Pro to Free on Nov 1, 2026/)
    expect(screen.getByTestId("plan-card-free").textContent).toMatch(
      /Scheduled/,
    )
    fireEvent.click(screen.getByRole("button", { name: "Undo change" }))
    await waitFor(() =>
      expect(mocks.undo).toHaveBeenCalledWith(
        "34971786-dd50-492b-b934-306b63764c4b",
        "use:team-a",
      ),
    )
  })

  it("blocks upgrades while a downgrade is scheduled", () => {
    mocks.plan.mockReturnValue({
      data: {
        ...pro,
        key: "starter",
        kind: "prepaid",
        name: "Starter",
        pending_change: {
          id: "34971786-dd50-492b-b934-306b63764c4b",
          pauses_running: true,
          plan_key: "free",
          plan_name: "Free",
          effective_at: "2026-11-01T00:00:00Z",
          undoable: true,
        },
      },
      isError: false,
    })
    mount()
    expect(screen.queryByRole("link", { name: "Get Pro" })).toBeNull()
    expect(
      screen.getByText("Undo your scheduled change before upgrading."),
    ).toBeTruthy()
  })

  it("tells when an upgrade becomes possible if the change can't be undone", () => {
    mocks.plan.mockReturnValue({
      data: {
        ...pro,
        key: "starter",
        kind: "prepaid",
        name: "Starter",
        pending_change: {
          id: "34971786-dd50-492b-b934-306b63764c4b",
          pauses_running: true,
          plan_key: "free",
          plan_name: "Free",
          effective_at: "2026-11-01T00:00:00Z",
          undoable: false,
        },
      },
      isError: false,
    })
    mount()
    expect(
      screen.getByText(
        "You can upgrade after your scheduled change on Nov 1, 2026.",
      ),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Undo change" })).toBeNull()
  })

  it("offers Developer to a Free team instead of calling it unavailable", () => {
    const pro = catalog.find((entry) => entry.key === "pro_monthly")!
    mocks.catalog.mockReturnValue({
      data: [
        ...catalog,
        {
          ...pro,
          key: "developer_monthly",
          family: "developer",
          name: "Builder",
          funding_policy: "prepaid",
        },
      ],
    })
    mocks.plan.mockReturnValue({
      data: { ...pro, key: "free", kind: "free", name: "Free" },
      isError: false,
    })
    mount()
    const card = screen.getByTestId("plan-card-developer_monthly")
    expect(card.textContent).not.toMatch(/Not currently available/)
    expect(
      screen.getByRole("link", { name: "Get Builder" }).getAttribute("href"),
    ).toMatch(/\/billing\/pro\/?\?plan=developer$/)
    expect(screen.getByRole("link", { name: "Get Pro" })).toBeTruthy()
  })

  it("tells a team on a subscription to contact support to change plans", () => {
    const pro = catalog.find((entry) => entry.key === "pro_monthly")!
    mocks.catalog.mockReturnValue({
      data: [
        ...catalog,
        {
          ...pro,
          key: "developer_monthly",
          family: "developer",
          name: "Builder",
          funding_policy: "prepaid",
        },
      ],
    })
    const { unmount } = mount()
    expect(screen.queryByTestId("plan-card-developer_monthly")).toBeNull()
    expect(
      screen.getByText(/Need a different plan\? Contact support/).textContent,
    ).toBe(
      "Need a different plan? Contact support in your priority Slack channel or at support@superserve.ai.",
    )
    unmount()

    mocks.plan.mockReturnValue({
      data: {
        ...pro,
        key: "developer_monthly",
        name: "Builder",
        funding_policy: "prepaid",
      },
      isError: false,
    })
    mount()
    expect(screen.queryByTestId("plan-card-pro_monthly")).toBeNull()
    expect(
      screen.getByText(/Need a different plan\? Contact support/).textContent,
    ).toBe("Need a different plan? Contact support at support@superserve.ai.")
  })

  it.each([
    ["Free", { key: "free", kind: "free" as const, name: "Free" }],
    [
      "legacy pay-as-you-go",
      { key: "payg", kind: "legacy_payg" as const, name: "Pay as you go" },
    ],
  ])("shows a %s team no Starter card", (_, current) => {
    const pro = catalog.find((entry) => entry.key === "pro_monthly")!
    mocks.plan.mockReturnValue({
      data: { ...pro, ...current },
      isError: false,
    })
    mount()
    expect(screen.queryByTestId("plan-card-starter")).toBeNull()
    expect(screen.queryByRole("link", { name: "Get Starter" })).toBeNull()
    expect(screen.getByRole("link", { name: "Get Pro" })).toBeTruthy()
  })

  it("shows an Enterprise team no Starter card", () => {
    const pro = catalog.find((entry) => entry.key === "pro_monthly")!
    mocks.plan.mockReturnValue({
      data: {
        ...pro,
        key: "enterprise",
        kind: "custom",
        name: "Enterprise",
        pending_change: null,
      },
      isError: false,
    })
    mount()
    expect(screen.queryByTestId("plan-card-starter")).toBeNull()
    const enterprise = screen.getByTestId("plan-card-enterprise").textContent
    expect(enterprise).toMatch(/Custom limits/)
    expect(enterprise).not.toMatch(/running at once|concurrency/)
  })

  it("still shows a Starter team its own plan", () => {
    const pro = catalog.find((entry) => entry.key === "pro_monthly")!
    mocks.plan.mockReturnValue({
      data: { ...pro, key: "starter", kind: "prepaid", name: "Starter" },
      isError: false,
    })
    mount()
    expect(screen.getByTestId("plan-card-starter").textContent).toMatch(
      /Current plan/,
    )
  })

  it("explains an empty plan catalog", () => {
    mocks.catalog.mockReturnValue({ data: [] })
    mount()
    expect(screen.getByText(/Plans couldn't be loaded/)).toBeTruthy()
  })

  it("doesn't claim missing permissions before they load", () => {
    mocks.summary.mockReturnValue({ data: undefined })
    mount()
    expect(screen.queryByText(/Only billing administrators/)).toBeNull()
  })

  it("shows plans without actions to members who cannot manage billing", () => {
    mocks.summary.mockReturnValue({
      data: { permissions: { can_view: true, can_manage: false } },
    })
    mount()
    expect(screen.getByText(/Only billing administrators/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /Get |Book/ })).toBeNull()
  })
})
