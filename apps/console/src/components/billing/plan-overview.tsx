import { Badge, Button, cn } from "@superserve/ui"
import Link from "next/link"

import { CornerBrackets } from "@/components/corner-brackets"
import type {
  BillingIncludedUsage,
  BillingPricingResponse,
} from "@/lib/api/billing"
import {
  describeSandboxSize,
  formatCents,
  type FreeAllowance,
  PLAN_ACTION_LINKS,
  type PrepaidBalance,
  type TeamPlan,
  UPGRADE_PATH,
} from "@/lib/api/billing-v2"

const EYEBROW =
  "font-mono text-[10px] font-semibold tracking-[0.18em] text-muted uppercase"

const dateTime = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  })

const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })

export function planPriceLabel(plan: TeamPlan): string {
  switch (plan.kind) {
    case "free":
      return ""
    case "prepaid":
      return "Prepaid credit"
    case "subscription":
      return plan.fee_cents === null
        ? "Subscription"
        : `${formatCents(plan.fee_cents)} / month`
    case "legacy_payg":
      return "Pay as you go"
    case "custom":
      return "Custom agreement"
  }
}

function Meter({
  value,
  max,
  tone,
}: {
  value: number
  max: number
  tone: "normal" | "warning" | "danger"
}) {
  const share = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0
  return (
    <div aria-hidden className="h-1.5 w-full overflow-hidden bg-foreground/10">
      <div
        className={cn(
          "h-full",
          tone === "normal" && "bg-brand",
          tone === "warning" && "bg-yellow-500",
          tone === "danger" && "bg-red-500",
        )}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  )
}

function Panel({
  title,
  id,
  children,
}: {
  title: string
  id?: string
  children: React.ReactNode
}) {
  return (
    <div id={id} className="space-y-3 p-5 sm:p-6">
      <p className={EYEBROW}>{title}</p>
      {children}
    </div>
  )
}

// This is a monetary compute equivalent, never a countdown or start authority.
export function allowanceEquivalentMinutes(
  remainingCents: number,
  pricing?: BillingPricingResponse | null,
): string | null {
  if (!pricing || pricing.currency !== "USD" || !Array.isArray(pricing.rates))
    return null
  const cpu = pricing.rates.filter(
    (rate) => rate.resource_key === "vcpu" && rate.display_unit === "vCPU-hour",
  )
  const memory = pricing.rates.filter(
    (rate) =>
      rate.resource_key === "memory_gib" && rate.display_unit === "GiB-hour",
  )
  if (cpu.length !== 1 || memory.length !== 1) return null
  const rates = [cpu[0]!.price_usd_hourly, memory[0]!.price_usd_hourly]
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 0)) return null
  const hourly = rates[0]! + rates[1]!
  if (
    !Number.isFinite(hourly) ||
    hourly <= 0 ||
    !Number.isFinite(remainingCents)
  )
    return null
  const minutes = Math.max(
    0,
    Math.floor((remainingCents / 100 / hourly) * 60 + 1e-8),
  )
  if (remainingCents > 0 && minutes === 0) return "Less than 1 minute"
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [
    hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "",
    rest || !hours ? `${rest} minute${rest === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

export function FreeAllowancePanel({
  allowance,
  pricing,
}: {
  allowance: FreeAllowance | null
  pricing?: BillingPricingResponse | null
}) {
  if (!allowance)
    return (
      <Panel title="Usage limits">
        <p className="text-sm text-muted">Allowance couldn&apos;t be loaded.</p>
      </Panel>
    )
  const total = allowance.allowance_cents
  if (!allowance.applies || total === null)
    return (
      <Panel title="Usage limits">
        <p className="text-sm text-muted">
          No runtime allowance applies to your team right now.
        </p>
      </Panel>
    )
  const open = allowance.window_started_at !== null
  const used = open ? allowance.used_cents : 0
  const remaining = open ? allowance.remaining_cents : total
  if (remaining === null || used === null)
    return (
      <Panel title="Usage limits">
        <p className="text-sm text-muted">
          Remaining allowance is unavailable.
        </p>
      </Panel>
    )
  const duration = allowanceEquivalentMinutes(remaining, pricing)
  const share = total > 0 ? remaining / total : 0
  const paused = open && allowance.paused === true
  return (
    <Panel title="Usage limits">
      <p className="text-3xl font-medium tracking-tight text-foreground">
        {duration ??
          new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumSignificantDigits: 3,
          }).format(remaining / 100)}{" "}
        <span className="text-sm font-normal text-muted">
          {duration ? "equivalent remaining" : "allowance remaining"}
        </span>
      </p>
      <Meter
        value={used}
        max={total}
        tone={
          paused || share <= 0 ? "danger" : share <= 0.2 ? "warning" : "normal"
        }
      />
      <p className="text-sm text-muted">
        {paused
          ? "Allowance used up. Running sandboxes are paused and can't start"
          : "Daily compute allowance"}
        {open && allowance.resets_at
          ? `${paused ? " until" : "; resets"} ${dateTime(allowance.resets_at)}.`
          : ". The 24-hour window starts when you next start a sandbox."}
        {duration
          ? " Current-rate equivalent at 1 vCPU and 1 GiB memory; actual runtime depends on sandbox size."
          : ""}
        {" Unused allowance does not roll over."}
      </p>
    </Panel>
  )
}

export function PrepaidPanel({ prepaid }: { prepaid: PrepaidBalance | null }) {
  if (!prepaid)
    return (
      <Panel title="Credit balance" id="credit">
        <p className="text-sm text-muted">Balance couldn&apos;t be loaded.</p>
      </Panel>
    )
  const recharge = prepaid.auto_recharge
  return (
    <Panel title="Credit balance" id="credit">
      <p
        className={cn(
          "text-3xl font-medium tracking-tight",
          prepaid.balance_cents <= 0 ? "text-destructive" : "text-foreground",
        )}
      >
        {formatCents(Math.max(prepaid.balance_cents, 0))}
      </p>
      <p className="text-sm text-muted" id="auto-recharge">
        {recharge.enabled &&
        recharge.amount_cents !== null &&
        recharge.threshold_cents !== null
          ? `Auto-recharge is on: adds ${formatCents(recharge.amount_cents)} when the balance drops below ${formatCents(recharge.threshold_cents)}.`
          : recharge.disabled_reason
            ? "Auto-recharge was turned off. Running sandboxes pause when the balance reaches $0."
            : "Auto-recharge is off. Running sandboxes pause when the balance reaches $0."}{" "}
        Credit never expires.
      </p>
      {recharge.in_flight ? (
        <p className="text-sm text-muted">A top-up is being processed.</p>
      ) : null}
    </Panel>
  )
}

export function IncludedUsagePanel({
  plan,
  usageCents,
  status,
  bridgeMonthlyStartsAt,
}: {
  plan: TeamPlan
  usageCents: number | null
  status?: BillingIncludedUsage["status"]
  bridgeMonthlyStartsAt?: string
}) {
  const included = plan.included_cents
  return (
    <Panel title="Included usage this period">
      {bridgeMonthlyStartsAt ? (
        <p className="text-sm text-muted">
          Next monthly billing period starts on {date(bridgeMonthlyStartsAt)}.
        </p>
      ) : status === "pending" || status === "not_issued" ? (
        <p className="text-sm text-muted">
          {status === "pending"
            ? "Included usage is being added."
            : "Included usage is added once payment is confirmed."}
        </p>
      ) : usageCents === null || included === null ? (
        <p className="text-sm text-muted">Usage couldn&apos;t be loaded.</p>
      ) : (
        <>
          <p className="text-3xl font-medium tracking-tight text-foreground">
            {formatCents(Math.min(usageCents, included))}{" "}
            <span className="text-sm font-normal text-muted">
              of {formatCents(included)} used
            </span>
          </p>
          <Meter value={usageCents} max={included} tone="normal" />
          <p className="text-sm text-muted">
            {usageCents > included
              ? `${formatCents(usageCents - included)} beyond the included usage, billed at usage rates`
              : "Usage beyond this is billed at usage rates"}
            {plan.period_end
              ? ` at the end of the period on ${date(plan.period_end)}.`
              : "."}
          </p>
        </>
      )}
    </Panel>
  )
}

export interface PlanOverviewProps {
  plan: TeamPlan
  allowance: FreeAllowance | null
  prepaid: PrepaidBalance | null
  usageCents: number | null
  includedUsageStatus?: BillingIncludedUsage["status"]
  bridgeMonthlyStartsAt?: string
  canManage: boolean
  canPurchase?: boolean
  allowancePricing?: BillingPricingResponse | null
}

export function PlanDetails({
  plan,
  canManage,
}: {
  plan: TeamPlan
  canManage: boolean
}) {
  const size = describeSandboxSize(plan.limits)
  const pending = plan.pending_change
  return (
    <div className="space-y-3 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <p className={EYEBROW}>Current plan</p>
        {pending ? <Badge variant="warning">Change scheduled</Badge> : null}
      </div>
      <p className="text-3xl font-medium tracking-tight text-foreground">
        {plan.name}
      </p>
      {planPriceLabel(plan) ? (
        <p className="text-sm text-muted">{planPriceLabel(plan)}</p>
      ) : null}
      {pending ? (
        <p className="text-sm text-foreground">
          Changes to {pending.plan_name} on {date(pending.effective_at)}.
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-2 text-sm">
        <dt className="text-muted">Running at once</dt>
        <dd className="text-foreground">
          {plan.limits.max_concurrent?.toLocaleString("en-US") ?? "Default"}
        </dd>
        {size ? (
          <>
            <dt className="text-muted">Per sandbox</dt>
            <dd className="text-foreground">{size}</dd>
          </>
        ) : null}
        {plan.limits.max_templates !== null ? (
          <>
            <dt className="text-muted">Custom templates</dt>
            <dd className="text-foreground">
              {plan.limits.max_templates.toLocaleString("en-US")}
            </dd>
          </>
        ) : null}
      </dl>
      {canManage ? (
        <div className="flex flex-wrap gap-3">
          <Button
            size="sm"
            variant="outline"
            render={<Link href={UPGRADE_PATH} />}
          >
            Change plan
          </Button>
          {plan.kind === "prepaid" ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link href={PLAN_ACTION_LINKS.starter} />}
            >
              Manage auto-recharge
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function PlanOverview({
  plan,
  allowance,
  prepaid,
  usageCents,
  includedUsageStatus,
  bridgeMonthlyStartsAt,
  allowancePricing,
  canManage,
  canPurchase = true,
}: PlanOverviewProps) {
  return (
    <section
      aria-label="Usage and balance"
      className="relative mx-auto w-full max-w-4xl border border-dashed border-border bg-surface/40"
      data-testid="plan-overview"
    >
      <CornerBrackets size="sm" className="border-brand/70" />
      <div>
        {plan.kind === "free" ? (
          <FreeAllowancePanel
            allowance={allowance}
            pricing={allowancePricing}
          />
        ) : plan.kind === "prepaid" ? (
          <PrepaidPanel prepaid={prepaid} />
        ) : plan.kind === "subscription" ? (
          <IncludedUsagePanel
            plan={plan}
            usageCents={usageCents}
            status={includedUsageStatus}
            bridgeMonthlyStartsAt={bridgeMonthlyStartsAt}
          />
        ) : (
          <Panel title="Billing">
            <p className="text-sm text-muted">
              {plan.kind === "custom" ? (
                <>
                  Billed under your agreement.{" "}
                  <Link
                    href={PLAN_ACTION_LINKS.enterprise}
                    className="underline underline-offset-4"
                  >
                    Contact us
                  </Link>{" "}
                  to change it.
                </>
              ) : (
                "Usage is billed monthly at usage rates."
              )}
            </p>
          </Panel>
        )}
        {canManage &&
        canPurchase &&
        (plan.kind === "free" || plan.kind === "prepaid") ? (
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
            <Button
              size="sm"
              render={
                <Link
                  href={
                    plan.kind === "free"
                      ? UPGRADE_PATH
                      : PLAN_ACTION_LINKS.starter
                  }
                />
              }
            >
              {plan.kind === "free" ? "Upgrade" : "Add more"}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
