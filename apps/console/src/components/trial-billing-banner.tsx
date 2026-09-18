"use client"

import { Button, cn } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useSyncExternalStore } from "react"

import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingPayment } from "@/hooks/use-billing-payment"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import type { BillingTrialBalance } from "@/lib/api/billing"
import { billingKeys } from "@/lib/api/query-keys"

// SS-484 billingTrialRunway accepts observations strictly newer than 15 minutes.
// Expire cached observations too, including when background polling is suspended.
const RUNWAY_FRESHNESS_MS = 15 * 60_000

export function hasCurrentUrgentRunway(
  trial: Pick<BillingTrialBalance, "runway_state" | "runway_observed_at">,
  now: number,
) {
  const observed = Date.parse(trial.runway_observed_at ?? "")
  return (
    trial.runway_state === "under_24h" &&
    observed <= now &&
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
      if (!Number.isFinite(delay) || delay <= 0 || delay > RUNWAY_FRESHNESS_MS)
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

export function TrialBillingBanner() {
  const { teamKey, ready } = useBillingContext()
  const summaryQuery = useBillingSummary()
  const summary = ready && !summaryQuery.isError ? summaryQuery.data : undefined
  const { submitting, available, openSession } = useBillingPayment(
    summary,
    teamKey,
  )
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const trial = summary?.trial
  const currentUrgentRunway = useCurrentUrgentRunway(trial)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("billing")) {
      void queryClient.invalidateQueries({ queryKey: billingKeys.all })
    }
    // The billing page owns parameter cleanup and its return notice.
  }, [pathname, queryClient])

  if (
    !summary?.permissions?.can_view ||
    !trial ||
    (trial.state !== "active" && trial.state !== "exhausted")
  )
    return null

  const exhausted = trial.state === "exhausted"
  const urgent = exhausted || currentUrgentRunway
  const remaining =
    typeof trial.remaining_usd === "number" &&
    Number.isFinite(trial.remaining_usd)
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(trial.remaining_usd)
      : null

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
            Your free trial credit has run out. Add a payment method to unlock{" "}
            <strong>$95 in credits</strong> and restore sandbox access.
          </>
        ) : urgent ? (
          <>
            Based on your recent usage, your trial credit may run out within the
            next 24 hours. Add a payment method to unlock{" "}
            <strong>$95 in credits</strong> and keep your sandboxes running.
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
            . Add a payment method to unlock{" "}
            <strong>$95 in additional credits</strong>.
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
