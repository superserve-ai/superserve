"use client"

import { Badge, Button, cn, useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { PageHeader } from "@/components/page-header"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useTeamPlan } from "@/hooks/use-billing-v2"
import {
  useCatalogPlans,
  usePricingVersionState,
} from "@/hooks/use-pricing-version"
import {
  type CatalogPlan,
  describeSandboxSize,
  formatCents,
  PLAN_ACTION_LINKS,
  planAction,
  type TeamPlan,
} from "@/lib/api/billing-v2"
import { schedulePlanChange, undoPlanChange } from "@/lib/api/plan-changes"
import { billingKeys } from "@/lib/api/query-keys"

import { PlanChangeDialog } from "./plan-change-dialog"

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
  onDowngrade,
}: {
  plan: CatalogPlan
  current: TeamPlan
  canManage: boolean
  onDowngrade: (plan: CatalogPlan) => void
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
      ) : action.type === "downgrade" ? (
        <Button size="sm" variant="outline" onClick={() => onDowngrade(plan)}>
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
            href={PLAN_ACTION_LINKS.enterprise}
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
  const version = usePricingVersionState()
  const v2 = version === "v2"
  const { teamKey, ready, cacheScope } = useBillingContext()
  const planQuery = useTeamPlan(true)
  const catalogQuery = useCatalogPlans()
  const catalog = catalogQuery.isError ? [] : (catalogQuery.data ?? [])
  const summaryQuery = useBillingSummary()
  const summary = summaryQuery.isError ? undefined : summaryQuery.data
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [target, setTarget] = useState<{
    plan: Pick<CatalogPlan, "key" | "kind" | "name">
    teamKey: string
  } | null>(null)
  const [undoing, setUndoing] = useState(false)

  useEffect(() => {
    if (version === "legacy" && planQuery.data === null)
      router.replace("/plan-usage")
  }, [version, planQuery.data, router])

  if (
    version === "unknown" ||
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
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  New purchases are unavailable. You can still leave your
                  current plan or undo a scheduled change.
                </p>
                {canManage && !plan.pending_change ? (
                  <div className="flex flex-wrap gap-3">
                    {plan.kind === "subscription" ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          teamKey &&
                          setTarget({
                            teamKey,
                            plan: {
                              key: "starter",
                              kind: "prepaid",
                              name: "Starter",
                            },
                          })
                        }
                      >
                        Switch to Starter
                      </Button>
                    ) : null}
                    {plan.kind !== "free" ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          teamKey &&
                          setTarget({
                            teamKey,
                            plan: { key: "free", kind: "free", name: "Free" },
                          })
                        }
                      >
                        Switch to Free
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : catalog.length === 0 ? (
              <p className="text-sm text-muted">
                Plans couldn&apos;t be loaded. Try again shortly.
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {(v2 ? catalog : []).map((entry) => (
                <PlanCard
                  key={entry.key}
                  plan={entry}
                  current={plan}
                  canManage={canManage}
                  onDowngrade={(entry) =>
                    teamKey && setTarget({ plan: entry, teamKey })
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
      {target && target.teamKey === teamKey && ready && canManage ? (
        <PlanChangeDialog
          key={`${target.teamKey}:${target.plan.key}`}
          target={target.plan}
          onClose={() => setTarget(null)}
          onConfirm={async (
            expectedTeam,
            idempotencyKey,
            previewToken,
            confirmPausesRunning,
            expectedEffectiveAt,
          ) => {
            const change = await schedulePlanChange(
              target.plan.key,
              expectedTeam,
              idempotencyKey,
              previewToken,
              confirmPausesRunning,
              expectedEffectiveAt,
            )
            setTarget(null)
            addToast(
              change.state === "scheduled"
                ? `Switch to ${change.target_display_name} scheduled for ${date(change.effective_at)}.`
                : change.state === "undone"
                  ? "The plan change has been undone."
                  : `Plan change to ${change.target_display_name} applied.`,
              "success",
            )
            await refresh()
          }}
        />
      ) : null}
    </div>
  )
}
