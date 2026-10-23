import { Badge, Button, cn } from "@superserve/ui"
import Link from "next/link"

import { CornerBrackets } from "@/components/corner-brackets"
import {
  describeSandboxSize,
  formatCents,
  type FreeAllowance,
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
      return "$0, no card required"
    case "prepaid":
      return "Prepaid credit"
    case "subscription":
      return plan.fee_cents === null
        ? "Monthly subscription"
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

export function FreeAllowancePanel({
  allowance,
}: {
  allowance: FreeAllowance | null
}) {
  if (!allowance)
    return (
      <Panel title="Daily runtime allowance">
        <p className="text-sm text-muted">Allowance couldn&apos;t be loaded.</p>
      </Panel>
    )
  const remaining = Math.max(
    allowance.allowance_cents - allowance.used_cents,
    0,
  )
  const used = allowance.allowance_cents
    ? allowance.used_cents / allowance.allowance_cents
    : 1
  return (
    <Panel title="Daily runtime allowance">
      <p className="text-3xl font-medium tracking-tight text-foreground">
        {formatCents(remaining)}{" "}
        <span className="text-sm font-normal text-muted">
          of {formatCents(allowance.allowance_cents)} left
        </span>
      </p>
      <Meter
        value={allowance.used_cents}
        max={allowance.allowance_cents}
        tone={
          allowance.paused || used >= 1
            ? "danger"
            : used >= 0.8
              ? "warning"
              : "normal"
        }
      />
      <p className="text-sm text-muted">
        {allowance.paused
          ? "Allowance used up. Running sandboxes are paused"
          : "Compute and memory at usage rates. Disk isn't counted"}
        {allowance.resets_at
          ? `${allowance.paused ? " until" : "; resets"} ${dateTime(allowance.resets_at)}.`
          : ". The 24-hour window starts when you next start a sandbox."}
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
          : "Auto-recharge is off. Running sandboxes pause when the balance reaches $0."}{" "}
        Credit never expires.
      </p>
    </Panel>
  )
}

export function IncludedUsagePanel({
  plan,
  usageCents,
}: {
  plan: TeamPlan
  usageCents: number | null
}) {
  const included = plan.included_cents ?? 0
  return (
    <Panel title="Included usage this period">
      {usageCents === null ? (
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
  canManage: boolean
}

export function PlanOverview({
  plan,
  allowance,
  prepaid,
  usageCents,
  canManage,
}: PlanOverviewProps) {
  const size = describeSandboxSize(plan.limits)
  const pending = plan.pending_change
  return (
    <section
      aria-label="Plan and limits"
      className="relative mx-auto grid w-full max-w-4xl border border-dashed border-border bg-surface/40 sm:grid-cols-2"
      data-testid="plan-overview"
    >
      <CornerBrackets size="sm" className="border-brand/70" />
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <p className={EYEBROW}>Plan</p>
          {pending ? <Badge variant="warning">Change scheduled</Badge> : null}
        </div>
        <p className="text-3xl font-medium tracking-tight text-foreground">
          {plan.name}
        </p>
        <p className="text-sm text-muted">{planPriceLabel(plan)}</p>
        {pending ? (
          <p className="text-sm text-foreground">
            Changes to {pending.plan_name} on {date(pending.effective_at)}.
          </p>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-2 text-sm">
          <dt className="text-muted">Running at once</dt>
          <dd className="text-foreground">
            {plan.limits.max_concurrent.toLocaleString("en-US")}
          </dd>
          {size ? (
            <>
              <dt className="text-muted">Per sandbox</dt>
              <dd className="text-foreground">{size}</dd>
            </>
          ) : null}
          {plan.limits.max_templates !== null ? (
            <>
              <dt className="text-muted">Templates</dt>
              <dd className="text-foreground">
                {plan.limits.max_templates.toLocaleString("en-US")}
              </dd>
            </>
          ) : null}
        </dl>
        {canManage && plan.kind !== "custom" ? (
          <Button
            size="sm"
            variant={plan.kind === "free" ? "default" : "outline"}
            render={<Link href={UPGRADE_PATH} />}
          >
            {plan.kind === "free" ? "Upgrade" : "Change plan"}
          </Button>
        ) : null}
      </div>
      <div className="border-t border-dashed border-border sm:border-t-0 sm:border-l">
        {plan.kind === "free" ? (
          <FreeAllowancePanel allowance={allowance} />
        ) : plan.kind === "prepaid" ? (
          <PrepaidPanel prepaid={prepaid} />
        ) : plan.kind === "subscription" ? (
          <IncludedUsagePanel plan={plan} usageCents={usageCents} />
        ) : (
          <Panel title="Billing">
            <p className="text-sm text-muted">
              {plan.kind === "custom"
                ? "Billed under your agreement. Contact us to change your plan."
                : "Usage is billed monthly at usage rates."}
            </p>
          </Panel>
        )}
      </div>
    </section>
  )
}
