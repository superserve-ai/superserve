import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ENTERPRISE_MEETING_URL } from "@/lib/api/billing-v2"
import type { TeamCatalog } from "@/lib/billing/plan-offers-actions"
import type { BillingOffer, PlanCard } from "@/lib/billing/plans"

const mocks = vi.hoisted(() => ({
  offers: null as BillingOffer[] | null,
  cards: [] as PlanCard[],
  next: null as Promise<TeamCatalog> | null,
  load: vi.fn(),
}))
vi.mock("@/lib/billing/plan-offers-actions", () => ({
  getTeamCatalogAction: async (locator: unknown) => {
    mocks.load(locator)
    const next = mocks.next
    mocks.next = null
    return (
      next ??
      (mocks.offers ? { offers: mocks.offers, cards: mocks.cards } : null)
    )
  },
}))

const locator = { account: "account-1", team: "use:team-1" }

import { PlanPickerOptions } from "./plan-picker-options"

const offer = (
  offer_key: string,
  display_name: string,
  extra: Partial<BillingOffer> = {},
): BillingOffer => ({
  offer_key,
  family: offer_key.split("_")[0]!,
  display_name,
  price_cents: 1100,
  interval_months: 1,
  included_credit_cents: 1100,
  funding_policy: "postpaid",
  topoff: null,
  sellable: true,
  ...extra,
})

const card = (family: string, extra: Partial<PlanCard> = {}): PlanCard => ({
  family,
  version: 3,
  kind: "subscription",
  name: family,
  price_label: "",
  tagline: "",
  features: [],
  display_only: false,
  monthly: null,
  annual: null,
  credit_summary: "",
  monthly_credit_cents: null,
  allowance: null,
  matching: null,
  limits: {
    max_concurrent: null,
    max_vcpu: null,
    max_memory_mib: null,
    max_disk_mib: null,
    max_templates: null,
  },
  ...extra,
})

afterEach(() => {
  cleanup()
  mocks.cards = []
})

describe("PlanPickerOptions", () => {
  it("renders each card from the catalog and highlights Developer for a Starter link", async () => {
    mocks.offers = [
      offer("developer_monthly", "Builder", {
        price_cents: 1700,
        included_credit_cents: 1300,
        funding_policy: "prepaid",
        topoff: {
          amount_cents: 700,
          threshold_cents: 300,
          default_enabled: true,
        },
      }),
      offer("pro_monthly", "Team", {
        price_cents: 31900,
        included_credit_cents: 29900,
      }),
    ]
    mocks.cards = [
      card("developer", {
        tagline: "For tinkering",
        features: ["Unlimited runtime", "Inbox support"],
        limits: {
          max_concurrent: 37,
          max_vcpu: 3,
          max_memory_mib: 6144,
          max_disk_mib: 99999,
          max_templates: 42,
        },
      }),
      card("pro", {
        tagline: "For shipping",
        features: ["Pager support within 6 hours"],
        limits: {
          max_concurrent: 2345,
          max_vcpu: 12,
          max_memory_mib: 49152,
          max_disk_mib: 99999,
          max_templates: 42,
        },
      }),
    ]
    render(<PlanPickerOptions preselected="starter" locator={locator} />)
    const builder = await screen.findByRole("form", { name: "Builder plan" })
    const action = new URL(builder.getAttribute("action")!, "https://x.test")
    expect(Object.fromEntries(action.searchParams)).toEqual({
      offer: "developer",
      ...locator,
    })
    expect(mocks.load).toHaveBeenCalledWith(locator)
    expect(builder).toHaveAttribute("data-highlighted", "true")
    expect(builder.textContent).toMatch(/\$17\/ month/)
    expect(builder.textContent).toMatch(/Includes \$13 of usage/)
    expect(builder.textContent).toMatch(/For tinkering/)
    expect(
      [...builder.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual([
      "Up to 37 concurrent sandboxes",
      "Up to 3 vCPU, 6 GiB memory per sandbox",
      "Auto Reload adds $7 when your balance drops under $3",
      "Inbox support",
    ])
    expect(builder.textContent).not.toMatch(/99999|97 GiB|42|disk|template/i)
    expect(screen.getByRole("button", { name: "Choose Builder" })).toBeTruthy()
    const team = screen.getByRole("form", { name: "Team plan" })
    expect(team).toHaveAttribute("data-highlighted", "false")
    expect(team.textContent).toMatch(/\$319\/ month/)
    expect(team.textContent).toMatch(/Includes \$299 of usage/)
    expect(
      [...team.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual([
      "Up to 2,345 concurrent sandboxes",
      "Up to 12 vCPU, 48 GiB memory per sandbox",
      "Extra usage billed at the end of each billing period",
      "Pager support within 6 hours",
    ])
  })

  it("keeps the offer's own terms when the catalog has no card for it", async () => {
    mocks.offers = [
      offer("developer_monthly", "Builder", {
        topoff: {
          amount_cents: 700,
          threshold_cents: 300,
          default_enabled: true,
        },
      }),
    ]
    render(<PlanPickerOptions preselected={null} locator={locator} />)
    const builder = await screen.findByRole("form", { name: "Builder plan" })
    expect(
      [...builder.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual(["Auto Reload adds $7 when your balance drops under $3"])
    expect(builder.textContent).toMatch(/Includes \$11 of usage each month/)
  })

  it("adds the catalog's Enterprise card with a meeting link beside the paid plans", async () => {
    mocks.offers = [offer("developer_monthly", "Builder")]
    mocks.cards = [
      card("enterprise", {
        kind: "custom",
        name: "Bespoke",
        price_label: "Talk to us",
        display_only: true,
      }),
    ]
    render(<PlanPickerOptions preselected={null} locator={locator} />)
    const enterprise = await screen.findByRole("region", {
      name: "Bespoke plan",
    })
    expect(enterprise.textContent).toMatch(/Talk to us/)
    expect(enterprise.textContent).toMatch(/Custom limits/)
    expect(
      screen.getByRole("link", { name: "Book a meeting" }),
    ).toHaveAttribute("target", "_blank")
    expect(
      screen.getByRole("link", { name: "Book a meeting" }),
    ).toHaveAttribute("href", ENTERPRISE_MEETING_URL)
    expect(screen.getByRole("form", { name: "Builder plan" })).toBeTruthy()
  })

  it("highlights a plan still on sale when the preselected one isn't", async () => {
    mocks.offers = [
      offer("developer_monthly", "Builder", { sellable: false }),
      offer("pro_monthly", "Team"),
    ]
    render(<PlanPickerOptions preselected="developer" locator={locator} />)
    expect(
      await screen.findByRole("form", { name: "Team plan" }),
    ).toHaveAttribute("data-highlighted", "true")
    expect(screen.queryByRole("form", { name: "Builder plan" })).toBeNull()
  })

  it("falls back to today's plan buttons when offers can't be read", async () => {
    mocks.offers = null
    render(<PlanPickerOptions preselected={null} locator={locator} />)
    expect(
      await screen.findByRole("button", { name: "Developer" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Pro" })).toBeTruthy()
  })

  it("sends only the first plan choice while Checkout opens", async () => {
    mocks.offers = [
      offer("developer_monthly", "Builder"),
      offer("pro_monthly", "Team"),
    ]
    render(<PlanPickerOptions preselected={null} locator={locator} />)
    const builder = await screen.findByRole("form", { name: "Builder plan" })
    const team = screen.getByRole("form", { name: "Team plan" })
    expect(fireEvent.submit(builder)).toBe(true)
    expect(await screen.findByText("Opening checkout…")).toBeTruthy()
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled()
    expect(fireEvent.submit(builder)).toBe(false)
    expect(fireEvent.submit(team)).toBe(false)
  })

  it("says so when no plan is sellable", async () => {
    mocks.offers = [offer("pro_monthly", "Team", { sellable: false })]
    render(<PlanPickerOptions preselected={null} locator={locator} />)
    expect(await screen.findByText(/No plans are available/)).toBeTruthy()
  })
})

it("never shows the previous team's offers on forms for a new team", async () => {
  mocks.offers = [offer("developer_monthly", "Team A price")]
  const { rerender } = render(
    <PlanPickerOptions preselected="developer" locator={locator} />,
  )
  await screen.findByRole("form", { name: "Team A price plan" })
  let resolve!: (catalog: TeamCatalog) => void
  const pending = new Promise<TeamCatalog>((r) => {
    resolve = r
  })
  mocks.next = pending
  const other = { account: locator.account, team: "use:team-2" }
  rerender(<PlanPickerOptions preselected="developer" locator={other} />)
  expect(screen.queryByRole("form", { name: "Team A price plan" })).toBeNull()
  expect(screen.queryByRole("button")).toBeNull()
  await act(async () =>
    resolve({
      offers: [
        offer("developer_monthly", "Team B price", { price_cents: 2500 }),
      ],
      cards: [],
    }),
  )
  const form = await screen.findByRole("form", { name: "Team B price plan" })
  expect(form.getAttribute("action")).toContain("team=use%3Ateam-2")
})
