"use client"

import { ChartBarIcon, LightningIcon } from "@phosphor-icons/react"
import {
  Spinner,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
  cn,
} from "@superserve/ui"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  BillingError,
  BillingSkeleton,
  BillingSummary,
  billingErrorMessage,
} from "@/components/billing-summary"
import { PlanOverviewSection } from "@/components/billing/plan-overview-section"
import {
  BILLING_UNKNOWN_LABEL,
  type BillingStatus,
  RESOURCE_SWATCH,
  UsageBreakdown,
  billingStatus,
  billingStatusNote,
  resourceSwatch,
} from "@/components/billing/usage-breakdown"
import {
  CustomerBillingSection,
  usePlanBillingControls,
} from "@/components/customer-billing-section"
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
import { useTeamPlan } from "@/hooks/use-billing-v2"
import { useTeams } from "@/hooks/use-teams"
import { useUser } from "@/hooks/use-user"
import type {
  BillingUsageGranularity,
  BillingUsageSeriesBucket,
  BillingUsageSeriesResource,
} from "@/lib/api/billing"

export {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  formatCount,
  formatDurationRemaining,
  getBillingCycleProgress,
  getProjectedPeriodEndEstimate,
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

// A missing status in any bucket wins, so unknown eligibility is never shown
// as a known billed or not-billed state.
function rangeBillingStatus(
  buckets: BillingUsageSeriesBucket[],
  key: UsageResourceKey,
): BillingStatus | "mixed" {
  const statuses = new Set(
    buckets.map((bucket) => billingStatus(bucket[key].billable)),
  )
  if (statuses.has("unknown")) return "unknown"
  if (statuses.size > 1) return "mixed"
  return statuses.has("not-billed") ? "not-billed" : "billed"
}

function storageLegend(buckets: BillingUsageSeriesBucket[]): string {
  if (buckets.length === 0) return "Storage"
  switch (rangeBillingStatus(buckets, "storage")) {
    case "billed":
      return "Storage"
    case "not-billed":
      return "Storage equivalent (not billed)"
    case "unknown":
      return `Storage (${BILLING_UNKNOWN_LABEL.toLowerCase()})`
    case "mixed":
      return "Storage (mixed billing eligibility)"
  }
}

function legendSwatch(
  buckets: BillingUsageSeriesBucket[],
  key: UsageResourceKey,
): string {
  if (buckets.length === 0) return RESOURCE_SWATCH[key]
  const status = rangeBillingStatus(buckets, key)
  return resourceSwatch(key, status === "mixed" ? "not-billed" : status)
}

function legendLabel(
  buckets: BillingUsageSeriesBucket[],
  key: "cpu" | "memory",
  label: string,
): string {
  return buckets.length > 0 && rangeBillingStatus(buckets, key) === "unknown"
    ? `${label} (${BILLING_UNKNOWN_LABEL.toLowerCase()})`
    : label
}

// Cost text for one resource, with its billing note when it is not billed.
function resourceCostText(resource: BillingUsageSeriesResource): string {
  const note = billingStatusNote(billingStatus(resource.billable))
  return `$${formatUsageCost(resource.cost_usd)}${note ? ` (${note})` : ""}`
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
  return [
    `${bucketLabel(bucket.start, granularity, granularity === "monthly", timezone)} (${start} – ${end})`,
    `CPU ${resourceCostText(bucket.cpu)}`,
    `Memory ${resourceCostText(bucket.memory)}`,
    `Storage ${resourceCostText(bucket.storage)}${bucket.storage.usage === null ? " · usage unavailable" : ""}`,
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

type BucketCosts = ReturnType<typeof bucketCostTotals>

function stackedCost(costs: BucketCosts) {
  return costs.cpu + costs.memory + costs.storage
}

function LegendItem({
  swatch,
  label,
  value,
}: {
  swatch: string
  label: string
  value: number
}) {
  return (
    <span className="flex items-center gap-2">
      <i aria-hidden className={cn("inline-block size-2", swatch)} />
      <span>{label}</span>
      <span className="font-mono text-foreground">
        ${formatUsageCost(value)}
      </span>
    </span>
  )
}

function ChartLegend({ buckets }: { buckets: BillingUsageSeriesBucket[] }) {
  const totals = buckets.reduce(
    (sum, bucket) => {
      const costs = bucketCostTotals(bucket)
      return {
        cpu: sum.cpu + costs.cpu,
        memory: sum.memory + costs.memory,
        storage: sum.storage + costs.storage,
        billed: sum.billed + Math.max(bucket.billed_total_usd, 0),
      }
    },
    { cpu: 0, memory: 0, storage: 0, billed: 0 },
  )
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs text-muted"
      aria-label="Chart legend"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <LegendItem
          swatch={legendSwatch(buckets, "cpu")}
          label={legendLabel(buckets, "cpu", "CPU")}
          value={totals.cpu}
        />
        <LegendItem
          swatch={legendSwatch(buckets, "memory")}
          label={legendLabel(buckets, "memory", "Memory")}
          value={totals.memory}
        />
        <LegendItem
          swatch={legendSwatch(buckets, "storage")}
          label={storageLegend(buckets)}
          value={totals.storage}
        />
      </div>
      <span className="font-mono uppercase">
        Billed{" "}
        <span className="text-foreground">
          ${formatUsageCost(totals.billed)}
        </span>
      </span>
    </div>
  )
}

// Segments stack bottom-up as CPU, memory, then storage. A transparent top
// border leaves a 2px gap below a visible segment without changing heights.
// Segments shorter than the gap keep their full fill so small costs show.
const BAR_HEIGHT_PX = 224
const SEGMENT_GAP = "border-t-2 border-transparent bg-clip-content"
const gapBelow = (value: number, above: number, max: number) =>
  above > 0 && (value / max) * BAR_HEIGHT_PX > 4 ? SEGMENT_GAP : null

const SEGMENT_LABEL: Record<UsageResourceKey, string> = {
  cpu: "CPU",
  memory: "Memory",
  storage: "Storage",
}

function BarSegment({
  resourceKey,
  resource,
  value,
  above,
  max,
}: {
  resourceKey: UsageResourceKey
  resource: BillingUsageSeriesResource
  value: number
  above: number
  max: number
}) {
  const status = billingStatus(resource.billable)
  const cost = `$${formatUsageCost(value)}`
  const notBilledStorage = resourceKey === "storage" && status === "not-billed"
  const note = billingStatusNote(status)
  return (
    <div
      className={cn(
        "w-full",
        status === "unknown" ? null : gapBelow(value, above, max),
        resourceSwatch(resourceKey, status),
      )}
      data-testid={
        notBilledStorage
          ? "storage-equivalent-bar"
          : status === "unknown"
            ? "billing-unknown-bar"
            : undefined
      }
      style={{ height: `${(value / max) * 100}%` }}
      aria-label={
        notBilledStorage
          ? `Storage equivalent ${cost} (not billed)`
          : `${SEGMENT_LABEL[resourceKey]} ${cost}${note ? ` (${note})` : ""}`
      }
    />
  )
}

function UsageBar({
  bucket,
  costs,
  max,
}: {
  bucket: BillingUsageSeriesBucket
  costs: BucketCosts
  max: number
}) {
  return (
    <div
      className="flex h-56 w-full max-w-10 flex-col justify-end opacity-90 transition-opacity group-hover:opacity-100"
      data-testid="billed-cost-stack"
    >
      <BarSegment
        resourceKey="storage"
        resource={bucket.storage}
        value={costs.storage}
        above={0}
        max={max}
      />
      <BarSegment
        resourceKey="memory"
        resource={bucket.memory}
        value={costs.memory}
        above={costs.storage}
        max={max}
      />
      <BarSegment
        resourceKey="cpu"
        resource={bucket.cpu}
        value={costs.cpu}
        above={costs.memory + costs.storage}
        max={max}
      />
    </div>
  )
}

function TooltipRow({
  swatch,
  label,
  value,
  note,
}: {
  swatch: string
  label: string
  value: number
  note?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        <i aria-hidden className={cn("inline-block size-2", swatch)} />
        {label}
        {note ? <span className="text-muted">{note}</span> : null}
      </span>
      <span className="font-mono">${formatUsageCost(value)}</span>
    </div>
  )
}

function BucketTooltipBody({
  bucket,
  title,
}: {
  bucket: BillingUsageSeriesBucket
  title: string
}) {
  const costs = bucketCostTotals(bucket)
  const keys: UsageResourceKey[] = ["cpu", "memory", "storage"]
  return (
    <div className="space-y-2 text-xs">
      <p className="text-[11px] leading-relaxed text-muted">{title}</p>
      <div className="space-y-1.5">
        {keys.map((key) => {
          const status = billingStatus(bucket[key].billable)
          const note = [
            billingStatusNote(status),
            bucket[key].usage === null && key === "storage"
              ? "usage unavailable"
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
          return (
            <TooltipRow
              key={key}
              swatch={resourceSwatch(key, status)}
              label={SEGMENT_LABEL[key]}
              value={costs[key]}
              note={note || undefined}
            />
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-dashed border-border pt-2 font-semibold">
        <span>Billed total</span>
        <span className="font-mono">
          ${formatUsageCost(bucket.billed_total_usd)}
        </span>
      </div>
    </div>
  )
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
  const teamPlan = useTeamPlan(!userLoading && !!user).data
  // A failed plan lookup must not hide independently authorized billing data.
  // Only a confirmed Free assignment suppresses payment setup.
  const showPayments = teamPlan?.kind !== "free"
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
  // Free teams keep the separate billing account strip instead.
  const billingControls = usePlanBillingControls({
    team: billingTeam,
    summary,
    enabled: teamPlan?.kind !== "free",
  })
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
          storage_mib_seconds?: number | null
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
        (value) => value != null && value !== 0,
      ),
    )

  const maxStackedCost =
    Math.max(
      ...buckets.map((bucket) => stackedCost(bucketCostTotals(bucket))),
      0,
    ) || 1

  // Label at most about a dozen buckets so dates do not crowd or wrap.
  const labelStep = Math.max(1, Math.ceil(buckets.length / 12))
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
      <PageHeader title="Billing & Usage" />

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
              <>
                <PlanOverviewSection
                  summary={summary}
                  billingControls={billingControls}
                />
                {showPayments ? <BillingSummary summary={summary} /> : null}
              </>
            ) : null}

            {billingTeam && (
              <CustomerBillingSection
                teamId={billingTeam.teamId}
                teamRegion={billingTeam.region}
                teamName={billingTeam.name}
                summary={summary ?? null}
                cardless={teamPlan?.kind === "free"}
              />
            )}

            {showPayments && summary ? (
              <UsageBreakdown summary={summary} />
            ) : null}

            <div className="mx-auto w-full max-w-4xl space-y-3">
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
                  className="space-y-4 border border-dashed border-border bg-surface/40 p-5"
                  data-testid="usage-cost-chart"
                >
                  {buckets.some((bucket) => bucket.storage.usage === null) ? (
                    <output className="block text-sm text-muted">
                      Some storage usage measurements are unavailable. Charges
                      shown include all billable usage.
                    </output>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      Usage over time
                    </h3>
                    <label className="flex items-center gap-2 font-mono text-xs text-muted uppercase">
                      View by
                      <select
                        aria-label="View by"
                        className="cursor-pointer border border-dashed border-border bg-background px-2 py-1 font-mono text-xs text-foreground uppercase"
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
                  <ChartLegend buckets={buckets} />
                  <div
                    className="flex h-64 items-end gap-1.5 overflow-x-auto border-b border-dashed border-border"
                    aria-label="Usage cost chart"
                    data-testid="usage-cost-chart-plot"
                  >
                    {buckets.map((bucket, index) => {
                      const costs = bucketCostTotals(bucket)
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
                      return (
                        <Tooltip key={bucket.start}>
                          <TooltipTrigger
                            className="group relative flex min-w-8 flex-1 cursor-default flex-col items-center justify-end gap-1.5"
                            aria-label={tooltipLines.join("\n")}
                            delay={0}
                          >
                            <UsageBar
                              bucket={bucket}
                              costs={costs}
                              max={maxStackedCost}
                            />
                            <span
                              className={cn(
                                "pb-1 font-mono text-[10px] whitespace-nowrap text-muted",
                                index % labelStep !== 0 && "invisible",
                              )}
                            >
                              {label}
                            </span>
                          </TooltipTrigger>
                          <TooltipPopup className="w-60 max-w-[calc(100vw-1rem)] border border-dashed border-border bg-surface/90 p-3 text-foreground shadow-lg backdrop-blur-md">
                            <BucketTooltipBody
                              bucket={bucket}
                              title={tooltipLines[0]}
                            />
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
