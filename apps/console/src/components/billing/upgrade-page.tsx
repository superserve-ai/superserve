"use client"

import { Badge, Button, cn, useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { PageHeader } from "@/components/page-header"
import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useTeamPlan } from "@/hooks/use-billing-v2"
import {
  useCatalogPlans,
  usePricingVersionState,
} from "@/hooks/use-pricing-version"
import { canStartPlan } from "@/lib/api/billing-capabilities"
import {
  type CatalogPlan,
  describeSandboxSize,
  ENTERPRISE_MEETING_URL,
  formatCents,
  planAction,
  type TeamPlan,
} from "@/lib/api/billing-v2"
import { undoPlanChange } from "@/lib/api/plan-changes"
import { billingKeys } from "@/lib/api/query-keys"

import { SupportContact, supportChannel } from "./plan-overview"

const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })

function PlanCard({
  plan,
  current,
  canManage,
}: {
  plan: CatalogPlan
  current: TeamPlan
  canManage: boolean
}) {
  const action = planAction(current, plan)
  const size = plan.limits ? describeSandboxSize(plan.limits) : null
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border border-dashed p-5",
        action.type === "current" ? "border-brand/70" : "border-border",
      )}
      data-testid={`plan-card-${plan.key}`}
    >
      <div className="flex items-center gap-2">
        <p className="text-lg font-medium text-foreground">{plan.name}</p>
        {action.type === "current" ? <Badge>Current plan</Badge> : null}
        {action.type === "scheduled" ? (
          <Badge variant="warning">Scheduled</Badge>
        ) : null}
      </div>
      <p className="text-2xl font-medium tracking-tight text-foreground">
        {plan.price_label}
      </p>
      <ul className="flex-1 space-y-1 text-sm text-muted">
        {plan.included_cents ? (
          <li>
            {formatCents(plan.included_cents)} of usage included each month
          </li>
        ) : null}
        {plan.limits ? (
          <li>
            {plan.limits.max_concurrent?.toLocaleString("en-US") ??
              "Custom concurrency"}{" "}
            running at once
          </li>
        ) : (
          <li>Custom limits and terms</li>
        )}
        {size ? <li>Up to {size} per sandbox</li> : null}
        {plan.kind === "free" ? (
          <li>
            Runtime allowance per 24-hour window; sandboxes pause when it runs
            out
          </li>
        ) : null}
      </ul>
      {!canManage ||
      action.type === "current" ||
      action.type === "scheduled" ? null : action.type === "link" ? (
        <Button size="sm" render={<Link href={action.href} />}>
          {action.label}
        </Button>
      ) : action.type === "blocked" ? (
        <p className="text-sm text-muted">
          {action.undoable
            ? "Undo your scheduled change before upgrading."
            : `You can upgrade after your scheduled change on ${date(action.effectiveAt)}.`}
        </p>
      ) : action.type === "unavailable" ? (
        <p className="text-sm text-muted">Not currently available.</p>
      ) : (
        <p className="text-sm text-muted">
          <Link
            href={ENTERPRISE_MEETING_URL}
            className="underline underline-offset-4"
          >
            Contact us
          </Link>{" "}
          to change your plan.
        </p>
      )}
    </div>
  )
}

function PendingChange({
  plan,
  canManage,
  onUndo,
  undoing,
}: {
  plan: TeamPlan
  canManage: boolean
  onUndo: () => void
  undoing: boolean
}) {
  const pending = plan.pending_change
  if (!pending) return null
  return (
    <output
      aria-label="Scheduled plan change"
      className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-warning/40 bg-warning/5 px-4 py-3 text-sm text-foreground"
    >
      <span>
        Your plan changes from {plan.name} to {pending.plan_name} on{" "}
        {date(pending.effective_at)}.
      </span>
      {canManage && pending.undoable ? (
        <Button size="sm" variant="outline" onClick={onUndo} disabled={undoing}>
          {undoing ? "Undoing…" : "Undo change"}
        </Button>
      ) : null}
    </output>
  )
}

export function UpgradePage() {
  const router = useRouter()
  const capabilities = useBillingCapabilities()
  const version = usePricingVersionState()
  const v2 = version === "v2" && capabilities.data?.entry_open === true
  const { teamKey, ready, cacheScope } = useBillingContext()
  const planQuery = useTeamPlan(true)
  const catalogQuery = useCatalogPlans()
  const catalog = catalogQuery.isError ? [] : (catalogQuery.data ?? [])
  const summaryQuery = useBillingSummary()
  const summary = summaryQuery.isError ? undefined : summaryQuery.data
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [undoing, setUndoing] = useState(false)

  useEffect(() => {
    if (version === "legacy" && planQuery.data === null)
      router.replace("/plan-usage")
  }, [version, planQuery.data, router])

  if (
    (version === "unknown" && !planQuery.data) ||
    (version === "legacy" && planQuery.data === null)
  )
    return null
  const plan = planQuery.data
  const permissionsKnown = summary?.permissions !== undefined
  const canManage =
    ready &&
    cacheScope === "self" &&
    teamKey !== null &&
    (summary?.permissions?.can_manage ?? false)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: billingKeys.all })

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Change plan">
        <Button size="sm" variant="ghost" render={<Link href="/plan-usage" />}>
          Back to billing
        </Button>
      </PageHeader>
      <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
        {!plan ? (
          <p className="text-sm text-muted">
            {planQuery.isError
              ? "Your plan couldn't be loaded. Try again shortly."
              : "Loading your plan…"}
          </p>
        ) : (
          <>
            {plan.kind === "subscription" ? (
              <SupportContact
                channel={supportChannel(plan, capabilities.data?.offers)}
                action="change your plan"
              />
            ) : null}
            <PendingChange
              plan={plan}
              canManage={canManage}
              undoing={undoing}
              onUndo={async () => {
                setUndoing(true)
                try {
                  if (!teamKey || !plan.pending_change) return
                  await undoPlanChange(plan.pending_change.id, teamKey)
                  addToast(
                    "Scheduled change undone. You'll stay on your current plan.",
                    "success",
                  )
                  await refresh()
                } catch {
                  addToast("The change couldn't be undone. Try again.", "error")
                } finally {
                  setUndoing(false)
                }
              }}
            />
            {permissionsKnown && !canManage ? (
              <p className="text-sm text-muted">
                Only billing administrators can change the plan.
              </p>
            ) : null}
            {!v2 ? (
              <p className="text-sm text-muted">
                New purchases are unavailable. You can still view your current
                plan and undo a scheduled change.
              </p>
            ) : catalog.length === 0 ? (
              <p className="text-sm text-muted">
                Plans couldn&apos;t be loaded. Try again shortly.
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {(v2 ? catalog : [])
                .filter(
                  (entry) => planAction(plan, entry).type !== "unavailable",
                )
                .map((entry) => (
                  <PlanCard
                    key={entry.key}
                    plan={entry}
                    current={plan}
                    canManage={
                      canManage &&
                      (entry.kind === "custom" ||
                        canStartPlan(capabilities.data, entry))
                    }
                  />
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
