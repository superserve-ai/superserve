"use client"

import {
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  CreditCardIcon,
} from "@phosphor-icons/react"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Spinner,
  cn,
} from "@superserve/ui"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useUser } from "@/hooks/use-user"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import { ApiError } from "@/lib/api/client"

const BREAKDOWN_ROWS = [
  {
    key: "compute",
    label: "Compute",
    description: "vCPU charges",
    barClassName: "bg-primary",
  },
  {
    key: "memory",
    label: "Memory",
    description: "GiB memory charges",
    barClassName: "bg-success",
  },
  {
    key: "storage",
    label: "Storage",
    description: "GiB storage charges",
    barClassName: "bg-warning",
  },
] as const

function currencyCode(summary: BillingSummaryResponse): string {
  return summary.pricing_tier.currency || "USD"
}

function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

function formatPeriodDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function billingErrorMessage(error: unknown): {
  title: string
  message: string
  suggestion?: string
} {
  if (error instanceof ApiError && error.status === 403) {
    return {
      title: "Billing Access Required",
      message: "Your account does not have billing read access for this team.",
      suggestion: "Ask a team owner to grant a billing role.",
    }
  }

  if (error instanceof ApiError && error.status === 401) {
    return {
      title: "Sign In Required",
      message: "Your session is missing or expired.",
      suggestion: "Sign in again to view billing.",
    }
  }

  return {
    title: "Billing Summary Unavailable",
    message:
      error instanceof Error
        ? error.message
        : "The billing summary could not be loaded.",
  }
}

export function BillingPageClient() {
  const router = useRouter()
  const { user, loading: userLoading } = useUser()
  const { data, isPending, error, refetch } = useBillingSummary(
    !userLoading && !!user,
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Billing">
        <Button
          render={<Link href="/plan-usage" />}
          size="sm"
          variant="outline"
        >
          <ChartBarIcon className="size-3.5" weight="light" />
          Usage
        </Button>
      </PageHeader>

      {userLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="border-foreground/20 border-t-foreground" />
        </div>
      ) : !user ? (
        <EmptyState
          icon={CreditCardIcon}
          title="Sign In Required"
          description="Your session is missing or expired. Sign in again to view billing."
          actionLabel="Sign In"
          onAction={() => router.push("/auth/signin?next=/billing")}
        />
      ) : isPending ? (
        <BillingSkeleton />
      ) : error ? (
        <BillingError error={error} onRetry={() => refetch()} />
      ) : data ? (
        <BillingSummary summary={data} />
      ) : (
        <ErrorState
          title="Billing Summary Unavailable"
          message="The billing summary could not be loaded."
          onRetry={() => refetch()}
        />
      )}
    </div>
  )
}

function BillingSummary({ summary }: { summary: BillingSummaryResponse }) {
  const currency = currencyCode(summary)
  const periodStart = formatPeriodDate(summary.billing_period.start)
  const periodEnd = formatPeriodDate(summary.billing_period.end)
  const lastUpdated = formatDateTime(summary.last_updated)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-mono text-xs text-muted uppercase">
            {summary.pricing_tier.plan_name} / {currency}
          </p>
          <p className="mt-1 text-sm text-foreground">
            Billing period: {periodStart} to {periodEnd}
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-muted uppercase">
          <ClockCounterClockwiseIcon className="size-4" />
          Updated {lastUpdated}
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryMetricCard
            title="Current Charges"
            value={formatCurrency(summary.current_charges_usd, currency)}
            description="Current period charges before credits"
          />
          <SummaryMetricCard
            title="Credits Remaining"
            value={formatCurrency(summary.credits_remaining_usd, currency)}
            description={`${formatCurrency(
              summary.credits_applied_usd,
              currency,
            )} applied this period`}
          />
          <SummaryMetricCard
            title="Expected Invoice"
            value={formatCurrency(
              summary.expected_invoice_amount_usd,
              currency,
            )}
            description="Estimated amount after credits"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
          <CostBreakdownCard summary={summary} currency={currency} />

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
            <DetailCard
              title="Billing Period"
              value={`${periodStart} to ${periodEnd}`}
              description="Current monthly billing window"
            />
            <DetailCard
              title="Last Updated"
              value={lastUpdated}
              description="Summary calculation timestamp"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryMetricCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="mt-0 font-mono text-xs uppercase">
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3">
        <p className="font-mono text-3xl text-foreground">{value}</p>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </CardContent>
    </Card>
  )
}

function CostBreakdownCard({
  summary,
  currency,
}: {
  summary: BillingSummaryResponse
  currency: string
}) {
  const total = Math.max(summary.current_charges_usd, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Breakdown</CardTitle>
        <CardDescription>
          Compute, memory, and storage charges for the current period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {BREAKDOWN_ROWS.map((row) => {
          const value = summary.cost_breakdown_usd[row.key]
          const percentage = total > 0 ? Math.max((value / total) * 100, 0) : 0

          return (
            <div key={row.key} className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {row.label}
                  </p>
                  <p className="text-xs text-muted">{row.description}</p>
                </div>
                <p className="font-mono text-sm text-foreground">
                  {formatCurrency(value, currency)}
                </p>
              </div>
              <div className="h-1.5 bg-surface-hover">
                <div
                  className={cn("h-full", row.barClassName)}
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function DetailCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="mt-0 font-mono text-xs uppercase">
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3">
        <p className="text-sm font-medium text-foreground">{value}</p>
        <p className="mt-2 text-xs text-muted">{description}</p>
      </CardContent>
    </Card>
  )
}

function BillingError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const details = billingErrorMessage(error)
  return (
    <ErrorState
      title={details.title}
      message={details.message}
      suggestion={details.suggestion}
      onRetry={onRetry}
    />
  )
}

function BillingSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-3 w-32" />
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-3 w-48" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-2 h-3 w-64" />
          </CardHeader>
          <CardContent className="space-y-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <div className="flex justify-between gap-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index}>
              <CardHeader>
                <Skeleton className="h-3 w-28" />
              </CardHeader>
              <CardContent className="space-y-3 pt-3">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-36" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
