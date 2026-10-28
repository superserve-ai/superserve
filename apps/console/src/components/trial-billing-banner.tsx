"use client"

import { Button, cn } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useCallback, useSyncExternalStore } from "react"

import {
  BannerShell,
  ManageAction,
} from "@/components/billing/plan-aware-banner"
import { useQueryScope } from "@/components/query-provider"
import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingPayment } from "@/hooks/use-billing-payment"
import { useBillingReturnNotice } from "@/hooks/use-billing-return-notice"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useTeamEntry } from "@/hooks/use-billing-v2"
import type {
  BillingSummaryResponse,
  BillingTrialBalance,
} from "@/lib/api/billing"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { pickerPlanLabel } from "@/lib/billing/plan-picker"
import {
  type AwaitingPlanState,
  planPickerPath,
  signupCheckoutPath,
  trialPlanOffer,
} from "@/lib/billing/signup-checkout-paths"

// SS-484 billingTrialRunway accepts observations strictly newer than 15 minutes.
// Expire cached observations too, including when background polling is suspended.
const RUNWAY_FRESHNESS_MS = 15 * 60_000
// The API has checked freshness using its clock; allow browsers slightly behind it.
const RUNWAY_CLOCK_SKEW_MS = 5 * 60_000

export function hasCurrentUrgentRunway(
  trial: Pick<BillingTrialBalance, "runway_state" | "runway_observed_at">,
  now: number,
) {
  const observed = Date.parse(trial.runway_observed_at ?? "")
  return (
    trial.runway_state === "under_24h" &&
    observed <= now + RUNWAY_CLOCK_SKEW_MS &&
    observed > now - RUNWAY_FRESHNESS_MS
  )
}

const getServerUrgency = () => false

function useCurrentUrgentRunway(trial: BillingTrialBalance | null | undefined) {
  const observedAt = trial?.runway_observed_at
  const runwayState = trial?.runway_state
  const subscribe = useCallback(
    (notify: () => void) => {
      const delay =
        Date.parse(observedAt ?? "") + RUNWAY_FRESHNESS_MS - Date.now()
      if (
        !Number.isFinite(delay) ||
        delay <= 0 ||
        delay > RUNWAY_FRESHNESS_MS + RUNWAY_CLOCK_SKEW_MS
      )
        return () => {}
      const timer = window.setTimeout(notify, delay)
      return () => window.clearTimeout(timer)
    },
    [observedAt],
  )
  const getSnapshot = useCallback(
    () =>
      hasCurrentUrgentRunway(
        { runway_state: runwayState, runway_observed_at: observedAt },
        Date.now(),
      ),
    [observedAt, runwayState],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getServerUrgency)
}

function formatUsd(amount: number | null | undefined): string | null {
  return typeof amount === "number" && Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount)
    : null
}

export type TrialStage = "trial" | "almost_used_up" | "ended" | "payment_failed"

// The trial's stage from its entry state and balance. The "almost used up"
// threshold is a backend setting; without it the trial has no such stage.
export function trialStage(
  entry: AwaitingPlanState,
  trial: BillingTrialBalance | null | undefined,
): TrialStage {
  if (entry === "payment_failed") return "payment_failed"
  const remaining = trial?.remaining_usd
  const known = typeof remaining === "number" && Number.isFinite(remaining)
  if (
    entry === "trial_ended" ||
    trial?.state === "exhausted" ||
    (known && remaining <= 0)
  )
    return "ended"
  const threshold = trial?.almost_used_up_usd
  return known &&
    typeof threshold === "number" &&
    Number.isFinite(threshold) &&
    remaining <= threshold
    ? "almost_used_up"
    : "trial"
}

function TrialEntryBanner({
  entry,
  summary,
}: {
  entry: AwaitingPlanState
  summary: BillingSummaryResponse
}) {
  const { teamKey } = useBillingContext()
  const scope = useQueryScope()
  const offers = useBillingCapabilities().data?.offers
  const signup = useQueryClient().getQueryData<SignupPlanContext>([
    "signup-plan",
    teamKey,
  ])
  const selected = trialPlanOffer(signup?.requestedOffer)
  const stage = trialStage(entry, summary.trial)
  const remaining = formatUsd(summary.trial?.remaining_usd)
  const plan = selected ? pickerPlanLabel(offers, selected) : null
  const upgrade = plan ? `Upgrade to ${plan}` : "Upgrade"
  const canManage = scope === "self" && summary.permissions.can_manage
  return (
    <BannerShell
      tone={
        stage === "trial"
          ? "info"
          : stage === "almost_used_up"
            ? "warning"
            : "danger"
      }
      label="Free trial"
      action={
        <ManageAction canManage={canManage}>
          {selected ? (
            <form method="post" action={signupCheckoutPath(selected)}>
              <Button type="submit" size="sm">
                {upgrade}
              </Button>
            </form>
          ) : (
            <Button
              size="sm"
              render={<Link href={planPickerPath("upgrade")} />}
            >
              {upgrade}
            </Button>
          )}
          {selected ? (
            <Link
              href={planPickerPath("upgrade", selected)}
              className="self-center underline underline-offset-4"
            >
              Other plans
            </Link>
          ) : null}
        </ManageAction>
      }
    >
      {stage === "payment_failed" ? (
        <>
          We couldn&apos;t confirm a card for your plan. Your sandboxes are
          paused and nothing is deleted. Upgrade to resume.
        </>
      ) : stage === "ended" ? (
        <>
          Your free trial has ended. Your sandboxes are paused and nothing is
          deleted. Upgrade to resume.
        </>
      ) : stage === "almost_used_up" ? (
        <>
          Your free trial is almost used up
          {remaining ? (
            <>
              : <strong>{remaining} left</strong>
            </>
          ) : null}
          . When it runs out, sandboxes pause and nothing is deleted. Upgrade to
          keep them running.
        </>
      ) : (
        <>
          You&apos;re on a free trial
          {remaining ? (
            <>
              {" "}
              with <strong>{remaining} left</strong>
            </>
          ) : null}
          . Upgrade to keep your sandboxes running once it&apos;s used up.
        </>
      )}
    </BannerShell>
  )
}

export function TrialBillingBanner() {
  const { ready } = useBillingContext()
  const summaryQuery = useBillingSummary()
  const summary = ready && !summaryQuery.isError ? summaryQuery.data : undefined
  const entryQuery = useTeamEntry(true)
  useBillingReturnNotice()
  if (entryQuery.isPending && !entryQuery.isError) return null
  const entry = entryQuery.data
  if (!summary?.permissions?.can_view) return null
  if (entry) return <TrialEntryBanner entry={entry} summary={summary} />
  return <LegacyTrialBanner summary={summary} />
}

function LegacyTrialBanner({ summary }: { summary: BillingSummaryResponse }) {
  const { teamKey } = useBillingContext()
  const { submitting, available, openSession } = useBillingPayment(
    summary,
    teamKey,
  )
  const trial = summary.trial
  const currentUrgentRunway = useCurrentUrgentRunway(trial)

  if (!trial || (trial.state !== "active" && trial.state !== "exhausted"))
    return null

  const exhausted = trial.state === "exhausted"
  const urgent = exhausted || currentUrgentRunway
  const remaining = formatUsd(trial.remaining_usd)

  return (
    <div
      role="status"
      aria-label="Free trial billing"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b px-4 py-3 text-sm",
        urgent
          ? "border-red-500/40 bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100"
          : "border-yellow-500/40 bg-yellow-100 text-yellow-950 dark:bg-yellow-950 dark:text-yellow-100",
      )}
    >
      <p className="min-w-0 flex-1 basis-72">
        {exhausted ? (
          <>
            Your free trial credit has run out. Add a payment method to continue
            running sandboxes.
          </>
        ) : urgent ? (
          <>
            Based on your recent usage, your trial credit may run out within the
            next 24 hours, and any running sandboxes will automatically be
            stopped. Add a payment method to continue running sandboxes.
          </>
        ) : (
          <>
            You&apos;re on a free trial
            {remaining ? (
              <>
                {" "}
                with <strong>{remaining} remaining</strong>
              </>
            ) : null}
            . Add a payment method to keep running sandboxes once it&apos;s used
            up.
          </>
        )}
      </p>
      {summary.permissions.can_manage ? (
        <Button
          size="sm"
          disabled={!available || submitting !== null}
          onClick={() => void openSession()}
        >
          {submitting ? "Loading..." : "Add Payment"}
        </Button>
      ) : (
        <p>Contact your team&apos;s billing administrator.</p>
      )}
    </div>
  )
}
