"use client"

import { ChartBarIcon, LightningIcon } from "@phosphor-icons/react"
import { Spinner, Tooltip, TooltipPopup, TooltipTrigger } from "@superserve/ui"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  BillingError,
  BillingSkeleton,
  BillingSummary,
  billingErrorMessage,
} from "@/components/billing-summary"
import { CustomerBillingSection } from "@/components/customer-billing-section"
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import {
  useDashboardTeamContext,
  useQueryScope,
} from "@/components/query-provider"
import { TableSkeleton } from "@/components/table-skeleton"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useBillingUsage } from "@/hooks/use-billing-usage"
import { useTeams } from "@/hooks/use-teams"
import { useUser } from "@/hooks/use-user"
import type {
  BillingUsageGranularity,
  BillingUsageSeriesBucket,
} from "@/lib/api/billing"

export {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  formatCount,
  formatDurationRemaining,
  getBillingCycleProgress,
  getProjectedPeriodEndEstimate,
  getProjectedStatementRows,
} from "@/components/billing-summary"

const getLocalTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const GRANULARITIES: BillingUsageGranularity[] = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
]
// Availability thresholds describe local calendar ranges, not elapsed time.
// Comparing local midnights keeps DST transitions from moving a range across
// the exact 7/14/60/90/365-day boundaries.
const days = (r: DateRange) => {
  const start = Date.UTC(
    r.start.getFullYear(),
    r.start.getMonth(),
    r.start.getDate(),
  )
  const end = Date.UTC(r.end.getFullYear(), r.end.getMonth(), r.end.getDate())
  return (end - start) / 86400000
}
export const isGranularityAvailable = (d: number, g: BillingUsageGranularity) =>
  g === "hourly"
    ? d <= 7
    : g === "daily"
      ? d <= 90
      : g === "weekly"
        ? d >= 14 && d <= 365
        : d >= 60
export const defaultGranularity = (d: number): BillingUsageGranularity =>
  d <= 7 ? "hourly" : d <= 90 ? "daily" : d <= 365 ? "weekly" : "monthly"
export const availableGranularities = (d: number) =>
  GRANULARITIES.filter((g) => isGranularityAvailable(d, g))

export function bucketLabel(
  start: string,
  granularity: BillingUsageGranularity,
  includeYear = false,
  timezone = "UTC",
) {
  const date = new Date(start)
  const opts: Intl.DateTimeFormatOptions =
    granularity === "hourly"
      ? { month: "short", day: "numeric", hour: "numeric" }
      : granularity === "monthly"
        ? includeYear
          ? { month: "short", year: "numeric" }
          : { month: "short", day: "numeric" }
        : { month: "short", day: "numeric" }
  return new Intl.DateTimeFormat([], {
    ...opts,
    timeZone: timezone,
  }).format(date)
}

export function formatUsageCost(value: number): string {
  return value > 0 && value < 0.01
    ? value.toLocaleString("en-US", {
        maximumSignificantDigits: 2,
        useGrouping: false,
      })
    : value.toFixed(2)
}

function storageLegend(buckets: BillingUsageSeriesBucket[]): string {
  if (buckets.length === 0) return "Storage"
  const billable = buckets.map((bucket) => bucket.storage.billable)
  if (billable.every(Boolean)) return "Storage"
  if (billable.every((value) => value === false)) {
    return "Storage equivalent (not billed)"
  }
  return "Storage (mixed billing eligibility)"
}

function bucketTooltip(
  bucket: BillingUsageSeriesBucket,
  granularity: BillingUsageGranularity,
  timezone = "UTC",
) {
  const startDate = new Date(bucket.start)
  const endDate = new Date(bucket.end)
  // Match the calendar timezone used to request the buckets.
  const tooltipDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    timeZone: timezone,
  })
  const start = tooltipDate.format(startDate)
  const end = tooltipDate.format(endDate)
  const storage = `$${formatUsageCost(bucket.storage.cost_usd)}${bucket.storage.billable === false ? " (not billed)" : ""}`
  return [
    `${bucketLabel(bucket.start, granularity, granularity === "monthly", timezone)} (${start} – ${end})`,
    `CPU $${formatUsageCost(bucket.cpu.cost_usd)}`,
    `Memory $${formatUsageCost(bucket.memory.cost_usd)}`,
    `Storage ${storage}${bucket.storage.usage === null ? " · usage unavailable" : ""}`,
    `Billed total $${formatUsageCost(bucket.billed_total_usd)}`,
  ]
}

type UsageResourceKey = "cpu" | "memory" | "storage"
function bucketResource(
  bucket: BillingUsageSeriesBucket,
  key: UsageResourceKey,
) {
  return bucket[key]
}

function bucketCostTotals(bucket: BillingUsageSeriesBucket) {
  return {
    cpu: Math.max(bucketResource(bucket, "cpu").cost_usd, 0),
    memory: Math.max(bucketResource(bucket, "memory").cost_usd, 0),
    storage: Math.max(bucketResource(bucket, "storage").cost_usd, 0),
  }
}

function defaultUsageRange(): DateRange {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 7)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function toDateRange(period?: {
  start: string
  end: string
}): DateRange | null {
  if (!period) return null
  return {
    start: new Date(period.start),
    end: new Date(period.end),
  }
}

export function PlanUsagePageClient() {
  const router = useRouter()
  const pathname = usePathname()
  const queryScope = useQueryScope()
  const { user, loading: userLoading } = useUser()
  const teamsQuery = useTeams()
  const dashboardTeam = useDashboardTeamContext()
  const summaryQuery = useBillingSummary(!userLoading && !!user)
  // Do not render retained summary data after a failed refresh. The billing
  // query is team-scoped, but React Query can still expose the last successful
  // value together with an error for that key; that value is not authoritative
  // while the current response is unavailable.
  const summary = summaryQuery.error ? undefined : summaryQuery.data
  const activeTeam = useMemo(() => {
    const teams = teamsQuery.data?.teams ?? []
    if (queryScope !== "self") {
      return teams.find((team) => team.id === queryScope) ?? null
    }

    return (
      teams.find(
        (team) =>
          team.id === teamsQuery.data?.activeTeamId &&
          team.region === teamsQuery.data?.activeRegion,
      ) ?? null
    )
  }, [queryScope, teamsQuery.data])
  const billingTeam = useMemo(() => {
    if (dashboardTeam) {
      return dashboardTeam
    }
    if (activeTeam) {
      return {
        teamId: activeTeam.id,
        region: activeTeam.region,
        name: activeTeam.name,
      }
    }
    return null
  }, [activeTeam, dashboardTeam])
  // Retain the viewed period on refresh errors without retaining billing claims.
  // This cached data belongs to the current team/region/impersonation query key.
  const billingPeriod = useMemo(
    () => toDateRange(summaryQuery.data?.billing_period),
    [summaryQuery.data?.billing_period],
  )
  const [fallbackRange] = useState<DateRange>(() => defaultUsageRange())
  const [dateRange, setDateRange] = useState<DateRange | null>(null)

  const selectedRange = dateRange ?? billingPeriod ?? fallbackRange
  const [granularity, setGranularity] = useState<BillingUsageGranularity>(() =>
    defaultGranularity(days(selectedRange)),
  )
  const granularitySelectedByUser = useRef(false)
  // The initial fallback range is seven days (hourly), but the billing period
  // arrives asynchronously.  Once it loads, synchronize the initial view to
  // that range unless the user has already selected a custom range.
  useEffect(() => {
    if (
      billingPeriod &&
      dateRange === null &&
      !granularitySelectedByUser.current
    ) {
      setGranularity(defaultGranularity(days(billingPeriod)))
    }
  }, [billingPeriod, dateRange])
  useEffect(() => {
    if (!isGranularityAvailable(days(selectedRange), granularity)) {
      setGranularity(defaultGranularity(days(selectedRange)))
      granularitySelectedByUser.current = false
    }
  }, [selectedRange, granularity])
  // Billing period is loaded asynchronously after the seven-day fallback.
  // Use its range-derived default immediately for the request/UI so an
  // intermediate hourly request cannot be issued for a longer period.
  const effectiveGranularity =
    !isGranularityAvailable(days(selectedRange), granularity) ||
    (billingPeriod && dateRange === null && !granularitySelectedByUser.current)
      ? defaultGranularity(days(selectedRange))
      : granularity
  // Usage-series requests always use the selected series signature, including
  // granularity and timezone, for every billing mode.
  const timezone = getLocalTimezone()
  // Keep the series signature independent of billing mode.  In particular,
  // live billing must not fall back to the legacy three-argument hook form:
  // granularity and timezone are part of the cache identity for every mode.
  const usageSeriesSignature = [
    selectedRange.start,
    selectedRange.end,
    effectiveGranularity,
    timezone,
    !userLoading && !!user,
  ] as const
  const usageQuery = useBillingUsage(...usageSeriesSignature)
  const usageData = usageQuery.data as
    | {
        buckets?: BillingUsageSeriesBucket[]
        granularity?: "hour" | "day" | "week" | "month"
        timezone?: string
        billing_mode?: string
        rows?: Array<{
          vcpu_seconds?: number
          memory_mib_seconds?: number
          storage_mib_seconds?: number
        }>
      }
    | undefined
  const buckets: BillingUsageSeriesBucket[] = usageData?.buckets ?? []
  const legacyRows = usageData?.rows ?? []
  const renderGranularity: BillingUsageGranularity =
    usageData?.granularity === "week"
      ? "weekly"
      : usageData?.granularity === "month"
        ? "monthly"
        : usageData?.granularity === "hour"
          ? "hourly"
          : effectiveGranularity
  // Usage-series resources are returned as top-level CPU, memory, and storage
  // fields on each bucket (there is no nested `resources` array).
  const hasUsage =
    buckets.some((bucket) =>
      (["cpu", "memory", "storage"] as const)
        .map((key) => bucketResource(bucket, key))
        .some((resource) => resource?.usage != null && resource.usage !== 0),
    ) ||
    legacyRows.some((row) =>
      [row.vcpu_seconds, row.memory_mib_seconds, row.storage_mib_seconds].some(
        (value) => value !== undefined && value !== 0,
      ),
    )

  const usageErrorDetails = usageQuery.error
    ? billingErrorMessage(usageQuery.error)
    : null

  const handleRangeChange = (range: DateRange | null) => {
    const next = range ?? billingPeriod
    setDateRange(next)
    // Use the billing-period-synchronized value when a preset is selected
    // before the asynchronous state update has committed.
    if (next && !isGranularityAvailable(days(next), effectiveGranularity))
      setGranularity(defaultGranularity(days(next)))
  }

  const signInPath = pathname ? `/auth/signin?next=${pathname}` : "/auth/signin"

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Billing & Usage">
        {summary ? (
          <p className="text-[11px] font-medium text-muted sm:text-right sm:text-sm">
            {summary.pricing_tier.plan_name} •{" "}
            {summary.pricing_tier.currency || "USD"}
          </p>
        ) : null}
      </PageHeader>

      {userLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="border-foreground/20 border-t-foreground" />
        </div>
      ) : !user ? (
        <EmptyState
          icon={LightningIcon}
          title="Sign In Required"
          description="Your session is missing or expired. Sign in again to view billing and usage."
          actionLabel="Sign In"
          onAction={() => router.push(signInPath)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-5">
            {summaryQuery.isPending ? (
              <BillingSkeleton />
            ) : summaryQuery.error ? (
              <BillingError
                error={summaryQuery.error}
                onRetry={() => void summaryQuery.refetch()}
              />
            ) : summary ? (
              <BillingSummary summary={summary} />
            ) : null}

            {billingTeam && (
              <CustomerBillingSection
                teamId={billingTeam.teamId}
                teamRegion={billingTeam.region}
                teamName={billingTeam.name}
                summary={summary ?? null}
              />
            )}

            <div className="border-t border-border/80 pt-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">
                    Usage Details
                  </h2>
                  <p className="text-sm text-muted">
                    Understand what is driving your current charges.
                  </p>
                </div>
                <DateRangeFilter
                  value={dateRange ?? billingPeriod ?? null}
                  billingPeriod={billingPeriod}
                  onChange={handleRangeChange}
                />
              </div>

              {usageQuery.isPending ? (
                <TableSkeleton columns={5} />
              ) : usageErrorDetails ? (
                <ErrorState
                  message={usageErrorDetails.message}
                  suggestion={usageErrorDetails.suggestion}
                  title={usageErrorDetails.title}
                  onRetry={() => void usageQuery.refetch()}
                />
              ) : !hasUsage &&
                !buckets.some((bucket) => bucket.storage.usage === null) ? (
                <EmptyState
                  icon={ChartBarIcon}
                  title="No Usage For This Period"
                  description="Usage will appear here after billing buckets are generated."
                />
              ) : (
                <section
                  className="space-y-4 border border-border/70 bg-surface/40 p-4"
                  data-testid="usage-cost-chart"
                >
                  {buckets.some((bucket) => bucket.storage.usage === null) ? (
                    <output className="block text-sm text-muted">
                      Some storage usage measurements are unavailable. Charges
                      shown include all billable usage.
                    </output>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-base font-semibold">Cost over time</h3>
                    <label className="text-sm">
                      View by{" "}
                      <select
                        aria-label="View by"
                        value={effectiveGranularity}
                        onChange={(e) => {
                          granularitySelectedByUser.current = true
                          setGranularity(
                            e.target.value as BillingUsageGranularity,
                          )
                        }}
                      >
                        {availableGranularities(days(selectedRange)).map(
                          (g) => (
                            <option key={g} value={g}>
                              {g[0].toUpperCase() + g.slice(1)}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <div
                    className="flex flex-wrap gap-4 text-xs text-muted"
                    aria-label="Chart legend"
                  >
                    <span>
                      <i className="mr-1 inline-block size-2 rounded-sm bg-primary" />
                      CPU
                    </span>
                    <span>
                      <i className="mr-1 inline-block size-2 rounded-sm bg-primary/60" />
                      Memory
                    </span>
                    <span>
                      <i className="mr-1 inline-block size-2 rounded-sm bg-muted" />
                      {storageLegend(buckets)}
                    </span>
                  </div>
                  <div
                    className="flex h-64 items-end gap-1 overflow-x-auto"
                    aria-label="Usage cost chart"
                    data-testid="usage-cost-chart-plot"
                  >
                    <div className="flex h-56 items-center pr-2 text-[10px] text-muted [writing-mode:vertical-rl]">
                      Billed cost (USD)
                    </div>
                    {buckets.map((bucket) => {
                      const { cpu, memory, storage } = bucketCostTotals(bucket)
                      const max =
                        Math.max(
                          ...buckets.map((b) =>
                            Math.max(b.billed_total_usd, b.storage.cost_usd, 0),
                          ),
                          0,
                        ) || 1
                      const label = bucketLabel(
                        bucket.start,
                        renderGranularity,
                        renderGranularity === "monthly",
                        usageData?.timezone ?? timezone,
                      )
                      const tooltipLines = bucketTooltip(
                        bucket,
                        renderGranularity,
                        usageData?.timezone ?? timezone,
                      )
                      const tooltip = tooltipLines.join("\n")
                      return (
                        <Tooltip key={bucket.start}>
                          <TooltipTrigger
                            className="relative flex min-w-10 flex-1 flex-col items-center justify-end gap-1"
                            aria-label={tooltip}
                            delay={0}
                          >
                            <div className="flex h-56 w-full items-end justify-center gap-0.5">
                              <div
                                className="flex h-full w-1/2 flex-col justify-end"
                                data-testid="billed-cost-stack"
                                aria-label={`Billed cost: CPU $${formatUsageCost(cpu)}, Memory $${formatUsageCost(memory)}`}
                              >
                                <div
                                  className="w-full bg-primary/60"
                                  style={{ height: `${(memory / max) * 100}%` }}
                                  aria-label={`Memory $${formatUsageCost(memory)}`}
                                />
                                <div
                                  className="w-full bg-primary"
                                  style={{ height: `${(cpu / max) * 100}%` }}
                                  aria-label={`CPU $${formatUsageCost(cpu)}`}
                                />
                                {bucket.storage.billable && (
                                  <div
                                    className="w-full bg-muted/70"
                                    style={{
                                      height: `${(storage / max) * 100}%`,
                                    }}
                                  />
                                )}
                              </div>
                              {!bucket.storage.billable && (
                                <div
                                  className="w-1/2 bg-muted"
                                  data-testid="storage-equivalent-bar"
                                  style={{
                                    height: `${(storage / max) * 100}%`,
                                  }}
                                  aria-label={`Storage equivalent $${formatUsageCost(storage)}${bucket.storage.billable === false ? " (not billed)" : ""}`}
                                />
                              )}
                            </div>
                            <span className="text-[10px] text-muted">
                              {label}
                            </span>
                          </TooltipTrigger>
                          <TooltipPopup className="w-64 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-surface p-2 text-foreground shadow-lg">
                            <p className="mb-1">{tooltipLines[0]}</p>
                            <ul className="list-disc space-y-1 pl-4">
                              {tooltipLines.slice(1).map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </TooltipPopup>
                        </Tooltip>
                      )
                    })}
                  </div>
                  {summary?.billing_mode === "shadow" && (
                    <p className="text-sm text-muted">
                      Your team is not being charged for this usage yet.
                      <span className="sr-only">Running</span>
                      <span className="sr-only">Paused</span>
                    </p>
                  )}
                </section>
              )}
              {legacyRows.length > 0 && summaryQuery.error && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <section data-testid="compute-section" />
                  <section data-testid="storage-section" />
                </div>
              )}
              {legacyRows.length > 0 &&
                usageData?.billing_mode !== "active" && (
                  <div data-testid="sandbox-state-section" className="sr-only">
                    <span>Running</span>
                    <span>Paused</span>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
