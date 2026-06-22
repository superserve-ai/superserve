"use client"

import {
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  LightningIcon,
} from "@phosphor-icons/react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useMemo, useState } from "react"

import { DateRangeFilter, type DateRange } from "@/components/date-range-filter"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { TableSkeleton } from "@/components/table-skeleton"
import { useBillingUsage } from "@/hooks/use-billing-usage"
import type { BillingUsageHourly } from "@/lib/api/billing-actions"

const EMPTY_ROWS: BillingUsageHourly[] = []

function defaultRange(): DateRange {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 7)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatHour(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    hour12: true,
  })
}

function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export function PlanUsagePageClient() {
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultRange())
  const { data, isPending, error, refetch } = useBillingUsage(
    dateRange.start,
    dateRange.end,
  )
  const rows = data?.rows ?? EMPTY_ROWS
  const latestUpdatedAt = rows[rows.length - 1]?.updated_at
  const isBillingPreview = data?.billing_mode === "preview"

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        vcpuSeconds: acc.vcpuSeconds + row.vcpu_seconds,
        memoryGibSeconds: acc.memoryGibSeconds + row.memory_mib_seconds / 1024,
        storageGibSeconds:
          acc.storageGibSeconds + row.storage_mib_seconds / 1024,
      }),
      {
        vcpuSeconds: 0,
        memoryGibSeconds: 0,
        storageGibSeconds: 0,
      },
    )
  }, [rows])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Plan & Usage" />

      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <p className="text-sm text-muted">
          Billing usage is scoped to your authenticated team. Ranges are capped
          at 90 days.
          {isBillingPreview
            ? " You are not being charged for this usage yet."
            : ""}
        </p>
        <DateRangeFilter
          value={dateRange}
          onChange={(range) => {
            if (range) setDateRange(range)
          }}
        />
      </div>

      {isPending ? (
        <TableSkeleton columns={5} />
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : data?.enabled === false ? (
        <EmptyState
          icon={LightningIcon}
          title="Free During Preview"
          description="Superserve is free during the preview period. We'll notify you before any pricing changes."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ChartBarIcon}
          title="No Usage For This Period"
          description="Usage will appear here after hourly billing rollups are generated."
        />
      ) : (
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {isBillingPreview && (
            <div className="border border-dashed border-border bg-brand/5 px-4 py-3 text-sm text-foreground">
              Usage is being shown for preview only. Your team is not being
              charged for this usage yet.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <UsageCard
              title="CPU Usage"
              description="Total active vCPU seconds"
              value={formatNumber(totals.vcpuSeconds)}
            />
            <UsageCard
              title="Memory Usage"
              description="Total active GiB memory seconds"
              value={formatNumber(totals.memoryGibSeconds)}
            />
            <UsageCard
              title="Active Storage"
              description="Total GiB storage seconds"
              value={formatNumber(totals.storageGibSeconds)}
            />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Hourly Usage</CardTitle>
                <CardDescription>
                  Provisional hourly rollups for the selected period.
                </CardDescription>
              </div>
              {latestUpdatedAt && (
                <div
                  className="flex items-center gap-2 font-mono text-xs text-muted uppercase"
                  suppressHydrationWarning
                >
                  <ClockCounterClockwiseIcon className="size-4" />
                  Updated {formatUpdatedAt(latestUpdatedAt)}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hour</TableHead>
                    <TableHead className="text-right">vCPU Seconds</TableHead>
                    <TableHead className="text-right">
                      Memory GiB Seconds
                    </TableHead>
                    <TableHead className="text-right">
                      Storage GiB Seconds
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.hour_start}>
                      <TableCell
                        className="font-mono text-xs text-muted"
                        suppressHydrationWarning
                      >
                        {formatHour(row.hour_start)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(row.vcpu_seconds)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(row.memory_mib_seconds / 1024)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(row.storage_mib_seconds / 1024)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function UsageCard({
  title,
  description,
  value,
}: {
  title: string
  description: string
  value: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-3xl text-foreground">{value}</p>
      </CardContent>
    </Card>
  )
}
