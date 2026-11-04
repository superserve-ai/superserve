"use client"

import { Badge, cn } from "@superserve/ui"

import { currencyCode, formatCurrency } from "@/components/billing-summary"
import { useAllowancePricing } from "@/hooks/use-billing-v2"
import type {
  BillingPricingRate,
  BillingSummaryResource,
  BillingSummaryResponse,
} from "@/lib/api/billing"

// Chart and table colours per resource. CPU uses the brand mint; storage is
// hatched instead of solid when it is tracked but not billed. A resource
// whose billing status is missing gets a dashed outline instead of a fill.
export const RESOURCE_SWATCH: Record<string, string> = {
  cpu: "bg-brand",
  memory: "bg-[#468e50]",
  storage: "bg-[#575757]",
}
export const NOT_BILLED_HATCH =
  "bg-[image:repeating-linear-gradient(45deg,#575757_0_1.5px,transparent_1.5px_3.5px)]"
export const BILLING_UNKNOWN_OUTLINE =
  "border border-dashed border-foreground/50"
export const BILLING_UNKNOWN_LABEL = "Billing status unavailable"

export type BillingStatus = "billed" | "not-billed" | "unknown"

// The API can omit `billable`; only an explicit false means "not billed".
export function billingStatus(
  billable: boolean | null | undefined,
): BillingStatus {
  if (billable === true) return "billed"
  if (billable === false) return "not-billed"
  return "unknown"
}

export function resourceSwatch(
  resource: string,
  status: BillingStatus,
): string {
  if (status === "unknown") return BILLING_UNKNOWN_OUTLINE
  if (resource === "storage" && status === "not-billed") return NOT_BILLED_HATCH
  return RESOURCE_SWATCH[resource] ?? "bg-foreground/40"
}

// Short note for chart labels and tooltips; null when the resource is billed.
export function billingStatusNote(status: BillingStatus): string | null {
  if (status === "not-billed") return "not billed"
  if (status === "unknown") return "billing status unavailable"
  return null
}

function formatMetric(value: number, suffix: string): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)} ${suffix}`
}

function formatRate(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: value < 0.001 ? 6 : 4,
    maximumFractionDigits: value < 0.001 ? 6 : 4,
  }).format(value)
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

// Second-based usage is reported in vCPU-seconds or MiB-seconds; the display
// units are vCPU-hours and GiB-hours.
function usageLabel(resource: BillingSummaryResource): string | null {
  if (resource.usage == null) return null
  const value =
    resource.unit === "second"
      ? resource.resource === "memory" || resource.resource === "storage"
        ? resource.usage / 1024 / 3600
        : resource.usage / 3600
      : resource.usage
  return formatMetric(value, resource.display_unit)
}

// Only billable charges count toward the total and each row's share.
function billedCharge(resource: BillingSummaryResource): number {
  return billingStatus(resource.billable) === "billed"
    ? Math.max(resource.charge_usd, 0)
    : 0
}

export function UsageBreakdown({
  summary,
}: {
  summary: BillingSummaryResponse
}) {
  const rates = useAllowancePricing(true).data?.rates
  const currency = currencyCode(summary)
  const resources = summary.resources.toSorted((a, b) => {
    const sortDiff = a.sort_order - b.sort_order
    if (sortDiff !== 0) return sortDiff
    return a.resource_key.localeCompare(b.resource_key)
  })
  if (resources.length === 0) return null

  const hasUnknown = resources.some(
    (resource) => billingStatus(resource.billable) === "unknown",
  )
  const billedTotal = resources.reduce(
    (total, resource) => total + billedCharge(resource),
    0,
  )

  return (
    <section
      className="mx-auto w-full max-w-4xl border border-dashed border-border bg-surface/40"
      aria-labelledby="usage-breakdown-title"
      data-testid="usage-breakdown"
    >
      <div className="flex items-center justify-between gap-3 border-b border-dashed border-border px-5 py-3.5">
        <h2
          id="usage-breakdown-title"
          className="text-sm font-semibold text-foreground"
        >
          Usage this period
        </h2>
        <p className="font-mono text-xs text-muted uppercase">
          {formatShortDate(summary.billing_period.start)} -{" "}
          {formatShortDate(summary.billing_period.end)}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-dashed border-border font-mono text-xs text-muted uppercase">
              <th className="px-5 py-3 text-left font-normal">Resource</th>
              <th className="px-3 py-3 text-right font-normal">Usage</th>
              <th className="px-3 py-3 text-right font-normal">Rate</th>
              <th className="px-3 py-3 text-right font-normal">Share</th>
              <th className="px-5 py-3 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => (
              <UsageRow
                key={resource.resource_key}
                resource={resource}
                rate={rates?.find(
                  (rate) => rate.resource_key === resource.resource_key,
                )}
                billedTotal={billedTotal}
                currency={currency}
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                colSpan={4}
                className="px-5 py-3.5 text-left font-semibold text-foreground"
              >
                Total
                {hasUnknown ? (
                  <span className="ml-2 font-normal text-muted">
                    Excludes resources with billing status unavailable
                  </span>
                ) : null}
              </th>
              <td className="px-5 py-3.5 text-right font-mono font-semibold text-foreground">
                {formatCurrency(billedTotal, currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function BillingStatusBadge({ status }: { status: BillingStatus }) {
  if (status === "not-billed") return <Badge variant="muted">Not billed</Badge>
  if (status === "unknown") {
    return (
      <Badge
        variant="muted"
        className="border border-dashed border-foreground/30 bg-transparent"
      >
        {BILLING_UNKNOWN_LABEL}
      </Badge>
    )
  }
  return null
}

function UsageRow({
  resource,
  rate,
  billedTotal,
  currency,
}: {
  resource: BillingSummaryResource
  rate: BillingPricingRate | undefined
  billedTotal: number
  currency: string
}) {
  const usage = usageLabel(resource)
  const status = billingStatus(resource.billable)
  const billed = status === "billed"
  const charge = billedCharge(resource)
  const share = billedTotal > 0 ? (charge / billedTotal) * 100 : 0
  const swatch = resourceSwatch(resource.resource, status)

  return (
    <tr className="border-b border-dashed border-border">
      <th scope="row" className="px-5 py-3 text-left font-normal">
        <span className="flex items-center gap-2 whitespace-nowrap text-foreground">
          <span aria-hidden className={cn("size-2 shrink-0", swatch)} />
          {resource.display_name}
          <BillingStatusBadge status={status} />
        </span>
      </th>
      <td
        className={cn(
          "px-3 py-3 text-right font-mono whitespace-nowrap",
          usage ? "text-foreground" : "text-muted",
        )}
      >
        {usage ?? "Usage unavailable"}
      </td>
      <td className="px-3 py-3 text-right font-mono whitespace-nowrap text-muted">
        {billed && rate
          ? `${formatRate(rate.price_usd_hourly, currency)} / ${rate.display_unit}`
          : "—"}
      </td>
      <td className="px-3 py-3">
        {status === "unknown" ? (
          <span className="block text-right font-mono text-muted">—</span>
        ) : (
          <span className="flex items-center justify-end gap-3">
            <span aria-hidden className="h-1 w-[90px] bg-foreground/10">
              <span
                className={cn("block h-full", swatch)}
                style={{ width: `${share}%` }}
              />
            </span>
            <span
              className={cn(
                "w-12 text-right font-mono",
                billed ? "text-foreground" : "text-muted",
              )}
            >
              {share.toFixed(1)}%
            </span>
          </span>
        )}
      </td>
      <td
        className={cn(
          "px-5 py-3 text-right font-mono",
          billed ? "text-foreground" : "text-muted",
        )}
      >
        {status === "unknown" ? "—" : formatCurrency(charge, currency)}
      </td>
    </tr>
  )
}
