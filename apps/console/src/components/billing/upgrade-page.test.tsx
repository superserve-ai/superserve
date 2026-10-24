import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CatalogPlan, TeamPlan } from "@/lib/api/billing-v2"
import consentWire from "@/test/fixtures/billing-plan-change-wire.json"

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

import { FREE_SWITCH_WARNING } from "./plan-change-dialog"
import { UpgradePage } from "./upgrade-page"

const freeLimits = {
  max_concurrent: 1,
  max_vcpu: 1,
  max_memory_mib: 1024,
  max_disk_mib: 4096,
  max_templates: null,
}
const previewToken = "a".repeat(64)
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
    kind: "free",
    name: "Free",
    price_label: "$0",
    available: true,
    fee_cents: 0,
    included_cents: null,
    limits: freeLimits,
  },
  {
    key: "starter",
    kind: "prepaid",
    name: "Starter",
    price_label: "Prepaid credit from $5",
    available: true,
    fee_cents: null,
    included_cents: null,
    limits: freeLimits,
  },
  {
    key: "pro_monthly",
    kind: "subscription",
    name: "Pro",
    price_label: "$250/month",
    available: true,
    fee_cents: 25000,
    included_cents: 25000,
    limits: proLimits,
  },
  {
    key: "enterprise",
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
    "keeps %s exits available while hiding purchases",
    async (kind) => {
      mocks.version.mockReturnValue("legacy")
      mocks.plan.mockReturnValue({ data: { ...pro, kind }, isError: false })
      mount()
      expect(
        screen.getByRole("button", { name: "Switch to Free" }),
      ).toBeTruthy()
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
    expect(container.textContent).toBe("")
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
  it("doesn't offer a blocked preview for confirmation", async () => {
    mocks.preview.mockResolvedValue(consentWire.blocked_preview)
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Switch to Free" }))
    await screen.findByText(consentWire.blocked_preview.blocked)
    expect(
      screen.getAllByRole("button", { name: "Switch to Free" }).at(-1),
    ).toHaveProperty("disabled", true)
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
  it("shows every plan with the right action for a Pro team", () => {
    mount()
    expect(screen.getByTestId("plan-card-pro_monthly").textContent).toMatch(
      /Current plan/,
    )
    expect(screen.getByRole("button", { name: "Switch to Free" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Switch to Starter" }),
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Book a meeting" })).toBeTruthy()
  })

  it("confirms bound Free terms and reports the authoritative schedule date", async () => {
    mocks.preview.mockResolvedValue({
      target_plan_key: "free",
      target_kind: "free",
      target_display_name: "Free",
      limits: freeLimits,
      preview_token: previewToken,
      effective_at: "2026-11-01T00:00:00.123456789Z",
      timing: "end_of_billing_period",
      pauses_running: true,
    })
    mocks.schedule.mockResolvedValue({
      id: "34971786-dd50-492b-b934-306b63764c4b",
      target_plan_key: "free",
      target_display_name: "Free",
      target_kind: "free",
      effective_at: "2026-11-02T00:00:00Z",
      pauses_running: true,
      state: "scheduled",
      undoable: true,
      limits: freeLimits,
    })
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Switch to Free" }))
    await screen.findByText(FREE_SWITCH_WARNING)
    expect(mocks.preview).toHaveBeenCalledWith("free", "use:team-a")
    expect(screen.getByRole("dialog").textContent).toMatch(
      /starting on Nov 1, 2026/,
    )
    expect(screen.getByRole("dialog").textContent).toMatch(
      /1 vCPU, 1 GiB memory, 4 GiB disk/,
    )
    fireEvent.click(
      screen.getAllByRole("button", { name: "Switch to Free" }).at(-1)!,
    )
    await waitFor(() =>
      expect(mocks.schedule).toHaveBeenCalledWith(
        "free",
        "use:team-a",
        expect.any(String),
        previewToken,
        true,
        "2026-11-01T00:00:00.123456789Z",
      ),
    )
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Switch to Free scheduled for Nov 2, 2026.",
        "success",
      ),
    )
  })

  it("keeps the dialog open and says so when the change fails", async () => {
    mocks.preview.mockResolvedValue({
      target_plan_key: "starter",
      target_kind: "prepaid",
      target_display_name: "Starter",
      limits: freeLimits,
      preview_token: previewToken,
      effective_at: "2026-11-01T00:00:00Z",
      timing: "end_of_billing_period",
      pauses_running: false,
    })
    mocks.schedule.mockRejectedValue(new Error("conflict"))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Switch to Starter" }))
    await screen.findByText(/Your plan changes to Starter on Nov 1, 2026/)
    expect(screen.queryByText(FREE_SWITCH_WARNING)).toBeNull()
    fireEvent.click(
      screen.getAllByRole("button", { name: "Switch to Starter" }).at(-1)!,
    )
    await screen.findByRole("alert")
    expect(screen.getByRole("dialog")).toBeTruthy()
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2))
    const confirm = screen
      .getAllByRole("button", { name: "Switch to Starter" })
      .at(-1)!
    await waitFor(() => expect(confirm).toHaveProperty("disabled", false))
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.schedule).toHaveBeenCalledTimes(2))
    expect(mocks.schedule.mock.calls[1]).toEqual(mocks.schedule.mock.calls[0])
  })

  it("requires new confirmation when a conflict refreshes the bound terms", async () => {
    const initial = {
      target_plan_key: "starter",
      target_kind: "prepaid",
      target_display_name: "Starter",
      limits: freeLimits,
      effective_at: "2026-11-01T00:00:00Z",
      timing: "end_of_billing_period",
      pauses_running: false,
      preview_token: previewToken,
    }
    mocks.preview.mockResolvedValueOnce(initial).mockResolvedValue({
      ...initial,
      effective_at: "2026-12-01T00:00:00Z",
      limits: { ...freeLimits, max_vcpu: 2 },
      preview_token: "b".repeat(64),
    })
    mocks.schedule.mockRejectedValue(new Error("plan_preview_changed"))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Switch to Starter" }))
    await screen.findByText(/Your plan changes to Starter on Nov 1/)
    fireEvent.click(
      screen.getAllByRole("button", { name: "Switch to Starter" }).at(-1)!,
    )
    await screen.findByText(/Your plan changes to Starter on Dec 1/)
    expect(screen.getByRole("dialog").textContent).toMatch(/2 vCPU/)
    expect(mocks.schedule).toHaveBeenCalledTimes(1)
    const confirm = screen
      .getAllByRole("button", { name: "Switch to Starter" })
      .at(-1)!
    await waitFor(() => expect(confirm).toHaveProperty("disabled", false))
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.schedule).toHaveBeenCalledTimes(2))
    expect(mocks.schedule.mock.calls[1]).toEqual([
      "starter",
      "use:team-a",
      mocks.schedule.mock.calls[0][2],
      "b".repeat(64),
      false,
      "2026-12-01T00:00:00Z",
    ])
  })

  it.each(["missing-token", "missing-pause-warning"])(
    "fails closed for %s",
    async (failure) => {
      mocks.preview.mockResolvedValue({
        target_plan_key: "free",
        target_kind: "free",
        target_display_name: "Free",
        limits: freeLimits,
        effective_at: "2026-11-01T00:00:00Z",
        timing: "end_of_billing_period",
        pauses_running: failure !== "missing-pause-warning",
        preview_token: failure === "missing-token" ? undefined : previewToken,
      })
      mount()
      fireEvent.click(screen.getByRole("button", { name: "Switch to Free" }))
      await screen.findByText(/couldn't check this change/)
      const confirm = screen
        .getAllByRole("button", { name: "Switch to Free" })
        .at(-1)!
      expect(confirm).toHaveProperty("disabled", true)
      fireEvent.click(confirm)
      expect(mocks.schedule).not.toHaveBeenCalled()
    },
  )

  it("never schedules without a preview", async () => {
    mocks.preview.mockRejectedValue(new Error("down"))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Switch to Free" }))
    await screen.findByText(/couldn't check this change/)
    expect(
      screen.getAllByRole("button", { name: "Switch to Free" }).at(-1),
    ).toHaveProperty("disabled", true)
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

  it("won't confirm with a stale preview after a failed refresh", async () => {
    mocks.preview
      .mockResolvedValueOnce({
        target_plan_key: "starter",
        target_kind: "prepaid",
        target_display_name: "Starter",
        limits: freeLimits,
        preview_token: previewToken,
        effective_at: "2026-11-01T00:00:00Z",
        timing: "end_of_billing_period",
        pauses_running: false,
      })
      .mockRejectedValue(new Error("down"))
    mocks.schedule.mockRejectedValue(new Error("conflict"))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Switch to Starter" }))
    await screen.findByText(/Your plan changes to Starter/)
    fireEvent.click(
      screen.getAllByRole("button", { name: "Switch to Starter" }).at(-1)!,
    )
    await screen.findByText(/couldn't check this change/)
    expect(
      screen.getAllByRole("button", { name: "Switch to Starter" }).at(-1),
    ).toHaveProperty("disabled", true)
  })

  it("says when a change is immediate", async () => {
    mocks.preview.mockResolvedValue({
      target_plan_key: "starter",
      target_kind: "prepaid",
      target_display_name: "Starter",
      limits: freeLimits,
      preview_token: previewToken,
      effective_at: "2026-10-23T12:00:00Z",
      timing: "immediate",
      pauses_running: false,
    })
    mocks.schedule.mockResolvedValue({
      state: "applied",
      target_display_name: "Starter",
    })
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Switch to Starter" }))
    await screen.findByText("Your plan changes to Starter immediately.")
    fireEvent.click(
      screen.getAllByRole("button", { name: "Switch to Starter" }).at(-1)!,
    )
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Plan change to Starter applied.",
        "success",
      ),
    )
    expect(mocks.schedule.mock.calls[0][5]).toBeUndefined()
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
