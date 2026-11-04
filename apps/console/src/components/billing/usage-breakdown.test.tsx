import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  BillingPricingRate,
  BillingSummaryResource,
  BillingSummaryResponse,
} from "@/lib/api/billing"

import { UsageBreakdown } from "./usage-breakdown"

const useAllowancePricing = vi.fn()

vi.mock("@/hooks/use-billing-v2", () => ({
  useAllowancePricing: (...args: unknown[]) => useAllowancePricing(...args),
}))

function resource(
  overrides: Partial<BillingSummaryResource> &
    Pick<BillingSummaryResource, "resource_key" | "resource" | "display_name">,
): BillingSummaryResource {
  return {
    sort_order: 10,
    unit: "second",
    display_unit: "GiB-hours",
    usage: 0,
    tracked: true,
    billable: true,
    charge_usd: 0,
    ...overrides,
  }
}

const resources: BillingSummaryResource[] = [
  resource({
    resource_key: "storage_gib",
    resource: "storage",
    display_name: "Storage",
    sort_order: 30,
    usage: 4_096_000,
    billable: false,
  }),
  resource({
    resource_key: "vcpu",
    resource: "cpu",
    display_name: "CPU",
    display_unit: "vCPU-hours",
    usage: 120,
    charge_usd: 60,
  }),
  resource({
    resource_key: "memory_gib",
    resource: "memory",
    display_name: "Memory",
    sort_order: 20,
    usage: 2_048_000,
    charge_usd: 20,
  }),
]

function summary(
  overrides: Partial<BillingSummaryResponse> = {},
): BillingSummaryResponse {
  return {
    billing_mode: "live",
    resources,
    billing_period: {
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-07-01T00:00:00.000Z",
    },
    pricing_tier: {
      plan_key: "payg",
      plan_name: "Pay-as-you-go",
      currency: "USD",
    },
    ...overrides,
  } as BillingSummaryResponse
}

function rate(resource_key: string, price: number, display_unit: string) {
  return {
    resource_key,
    price_usd_hourly: price,
    display_unit,
  } as BillingPricingRate
}

const rowFor = (name: RegExp) => screen.getByRole("row", { name })

describe("UsageBreakdown", () => {
  beforeEach(() => {
    useAllowancePricing.mockReturnValue({
      data: {
        rates: [
          rate("vcpu", 0.0504, "vCPU-hour"),
          rate("memory_gib", 0.0162, "GiB-hour"),
          rate("storage_gib", 0.000123, "GiB-hour"),
        ],
      },
    })
  })

  it("lists resources by sort order with usage, rate, share and cost", () => {
    render(<UsageBreakdown summary={summary()} />)

    const rows = within(screen.getByRole("table")).getAllByRole("row")
    expect(rows.map((row) => row.querySelector("th")?.textContent)).toEqual([
      "Resource",
      "CPU",
      "Memory",
      "StorageNot billed",
      "Total",
    ])
    expect(screen.getByText("Jun 1 - Jul 1")).toBeInTheDocument()

    const cpu = rowFor(/^CPU/)
    expect(cpu).toHaveTextContent("0.03 vCPU-hours")
    expect(cpu).toHaveTextContent("$0.0504 / vCPU-hour")
    expect(cpu).toHaveTextContent("75.0%")
    expect(cpu).toHaveTextContent("$60.00")

    const memory = rowFor(/^Memory/)
    expect(memory).toHaveTextContent("0.56 GiB-hours")
    expect(memory).toHaveTextContent("$0.0162 / GiB-hour")
    expect(memory).toHaveTextContent("25.0%")
    expect(memory).toHaveTextContent("$20.00")

    expect(rowFor(/^Total/)).toHaveTextContent("$80.00")
  })

  it("marks tracked storage as not billed and leaves it out of the total", () => {
    render(<UsageBreakdown summary={summary()} />)

    const storage = rowFor(/^Storage/)
    expect(within(storage).getByText("Not billed")).toBeInTheDocument()
    expect(storage).toHaveTextContent("1.11 GiB-hours")
    expect(storage).toHaveTextContent("—")
    expect(storage).toHaveTextContent("0.0%")
    expect(storage).toHaveTextContent("$0.00")
  })

  it.each([false, true])(
    "shows unknown storage usage without hiding known charges (billable %s)",
    (billable) => {
      render(
        <UsageBreakdown
          summary={summary({
            // The fixture lists storage first to check the sort order.
            resources: [
              {
                ...resources[0],
                usage: null,
                billable,
                charge_usd: billable ? 20 : 0,
              },
              ...resources.slice(1),
            ],
          })}
        />,
      )

      const storage = rowFor(/^Storage/)
      expect(storage).toHaveTextContent("Usage unavailable")
      expect(storage).not.toHaveTextContent(/GiB-hours/)
      expect(storage).toHaveTextContent(billable ? "$20.00" : "$0.00")
      if (billable) {
        expect(within(storage).queryByText("Not billed")).toBeNull()
      } else {
        expect(within(storage).getByText("Not billed")).toBeInTheDocument()
      }
      expect(rowFor(/^Total/)).toHaveTextContent(
        billable ? "$100.00" : "$80.00",
      )
      expect(rowFor(/^CPU/)).toHaveTextContent("0.03 vCPU-hours")
    },
  )

  it("shows no rate when pricing is unavailable", () => {
    useAllowancePricing.mockReturnValue({ data: undefined })
    render(<UsageBreakdown summary={summary()} />)

    expect(rowFor(/^CPU/)).toHaveTextContent("—")
    expect(rowFor(/^CPU/)).not.toHaveTextContent("/ vCPU-hour")
  })

  it("renders nothing without resources", () => {
    const { container } = render(
      <UsageBreakdown summary={summary({ resources: [] })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
