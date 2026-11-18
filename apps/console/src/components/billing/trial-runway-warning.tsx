"use client"

import { Button } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

import { BannerShell } from "@/components/billing/plan-aware-banner"
import { useQueryScope } from "@/components/query-provider"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useTeamEntry } from "@/hooks/use-billing-v2"
import { useFeatureFlagOn } from "@/hooks/use-feature-flag"
import { useUser } from "@/hooks/use-user"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { planPickerPath } from "@/lib/billing/signup-checkout-paths"
import {
  advanceRunway,
  FIXED_WARNING_USD,
  MAX_SAMPLE_MS,
  formatMinutesLeft,
  RUNWAY_WARNING_MINUTES,
  type RunwayTrack,
  runwayDecision,
  trialReading,
} from "@/lib/billing/trial-runway"
import { captureBestEffort } from "@/lib/posthog/capture"
import { TRIAL_RUNWAY_EVENTS } from "@/lib/posthog/events"

export const TRIAL_RUNWAY_WARNING_FLAG = "trial-runway-warning"

const SHOWN_KEY_PREFIX = "trial_runway_warning_shown:"
const shownTeams = new Set<string>()

// True the first time a team's warning shows in this tab session.
export function claimWarningShown(team: string): boolean {
  if (shownTeams.has(team)) return false
  shownTeams.add(team)
  try {
    if (window.sessionStorage.getItem(SHOWN_KEY_PREFIX + team)) return false
    window.sessionStorage.setItem(SHOWN_KEY_PREFIX + team, "1")
  } catch {
    // Without storage, the in-memory set dedupes for this page load.
  }
  return true
}

function round(value: number | null, digits: number): number | null {
  return value === null ? null : Number(value.toFixed(digits))
}

// Warns a team on its sign-up trial that the credit is about to run out, in
// place of the trial banner. Behind the trial-runway-warning PostHog flag.
export function TrialRunwayWarning({
  fallback,
}: {
  fallback: React.ReactNode
}) {
  const scope = useQueryScope()
  const { teamKey, ready } = useBillingContext()
  const summaryQuery = useBillingSummary()
  const summary = ready && !summaryQuery.isError ? summaryQuery.data : undefined
  const entry = useTeamEntry(true).data
  const reading = trialReading(summary, entry)

  // Keep the previous reading to measure the burn rate between polls.
  const [track, setTrack] = useState<RunwayTrack | null>(null)
  const nextTrack = advanceRunway(track, teamKey, reading)
  if (nextTrack !== track) setTrack(nextTrack)
  // Polling stops in a background tab, so an old estimate can be wrong.
  // Until a new summary arrives, use the fixed threshold instead.
  const fresh = Date.now() - summaryQuery.dataUpdatedAt <= MAX_SAMPLE_MS
  const burn =
    reading && fresh && nextTrack?.latestAt === reading.at
      ? nextTrack.burnUsdPerMinute
      : null
  const decision = reading ? runwayDecision(reading.remainingUsd, burn) : null

  // Support staff viewing a team do not see the experiment or send its events.
  const eligible = scope === "self" && decision?.show === true
  const flagOn = useFeatureFlagOn(TRIAL_RUNWAY_WARNING_FLAG, eligible)
  const show = eligible && flagOn && reading !== null && teamKey !== null

  const canManage = summary?.permissions.can_manage === true
  const queryClient = useQueryClient()
  const user = useUser().user
  const signup = show
    ? queryClient.getQueryData<SignupPlanContext>(["signup-plan", teamKey])
    : undefined
  const account = signup?.userId ?? user?.id
  // The picker lists plans only with an account and team.
  const href =
    account && teamKey
      ? planPickerPath("upgrade", undefined, { account, team: teamKey })
      : null

  const [region, teamId] = teamKey?.split(":", 2) ?? [null, null]
  const properties = {
    team_id: teamId ?? null,
    region: region ?? null,
    remaining_usd: round(reading?.remainingUsd ?? null, 6),
    threshold_mode: decision?.mode ?? null,
    threshold_minutes: RUNWAY_WARNING_MINUTES,
    threshold_usd: FIXED_WARNING_USD,
    minutes_left: round(decision?.minutesLeft ?? null, 1),
    burn_usd_per_minute: round(burn, 6),
    can_manage: canManage,
  }
  const posthog = usePostHog()
  const shownProperties = show ? JSON.stringify(properties) : null
  useEffect(() => {
    if (!shownProperties || !teamKey || !claimWarningShown(teamKey)) return
    captureBestEffort(
      posthog,
      TRIAL_RUNWAY_EVENTS.WARNING_SHOWN,
      JSON.parse(shownProperties) as Record<string, unknown>,
    )
  }, [posthog, shownProperties, teamKey])

  if (!show || !decision) return fallback

  return (
    <BannerShell
      tone="warning"
      label="Free trial credit"
      action={
        canManage && href ? (
          <Button
            size="sm"
            render={<Link href={href} />}
            onClick={() =>
              captureBestEffort(
                posthog,
                TRIAL_RUNWAY_EVENTS.WARNING_CLICKED,
                properties,
              )
            }
          >
            Choose a plan
          </Button>
        ) : null
      }
    >
      {decision.minutesLeft !== null ? (
        <>
          At your current usage, your free trial credit runs out in{" "}
          <strong>{formatMinutesLeft(decision.minutesLeft)}</strong>.
        </>
      ) : (
        <>Your free trial credit is almost used up.</>
      )}{" "}
      When it runs out, your running sandboxes stop.{" "}
      {canManage
        ? "Choose a plan to keep them running."
        : "Ask your team's billing administrator to choose a plan."}
    </BannerShell>
  )
}
