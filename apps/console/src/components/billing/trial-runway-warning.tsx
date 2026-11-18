"use client"

import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

import { BannerShell } from "@/components/billing/plan-aware-banner"
import { TrialUpgradeAction } from "@/components/billing/trial-upgrade-action"
import { useQueryScope } from "@/components/query-provider"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useTeamEntry } from "@/hooks/use-billing-v2"
import { useFeatureFlagOn } from "@/hooks/use-feature-flag"
import {
  advanceRunway,
  FIXED_WARNING_USD,
  MAX_SAMPLE_MS,
  formatMinutesLeft,
  nextMinutesLabelChange,
  RUNWAY_WARNING_MINUTES,
  type RunwayTrack,
  runwayDecision,
  trialReading,
} from "@/lib/billing/trial-runway"
import { captureBestEffort } from "@/lib/posthog/capture"
import { TRIAL_RUNWAY_EVENTS } from "@/lib/posthog/events"

export const TRIAL_RUNWAY_WARNING_FLAG = "trial-runway-warning"
// The summary poll interval. A summary older than this when it arrives is
// more likely a clock difference than a slow response.
const MAX_READING_AGE_MS = 60_000

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
  // The time of this render, kept in state so the React Compiler does not
  // reuse an old value. It moves on with each summary and each deadline below.
  const updatedAt = summaryQuery.dataUpdatedAt
  const [clock, setClock] = useState(() => ({ updatedAt, now: Date.now() }))
  if (clock.updatedAt !== updatedAt) setClock({ updatedAt, now: Date.now() })
  const now = clock.now
  // Polling stops in a background tab, so an old estimate can be wrong.
  // Until a new summary arrives, use the fixed threshold instead.
  const freshUntil = updatedAt + MAX_SAMPLE_MS
  const fresh = now <= freshUntil
  const burn =
    reading && fresh && nextTrack?.latestAt === reading.at
      ? nextTrack.burnUsdPerMinute
      : null
  const decision = reading ? runwayDecision(reading.remainingUsd, burn) : null
  // The estimate is from the last reading. After the time it predicts, show
  // no countdown until a new summary confirms the balance.
  // The balance is from calculated_at, so the time since then is already
  // used. The server and browser clocks can differ, so count at most
  // MAX_READING_AGE_MS of it.
  const readingAge = reading
    ? Math.min(Math.max(updatedAt - reading.at, 0), MAX_READING_AGE_MS)
    : 0
  const countdownUntil =
    decision?.minutesLeft != null
      ? updatedAt - readingAge + decision.minutesLeft * 60_000
      : null
  const countdown = countdownUntil !== null && now < countdownUntil
  // Polls can be late, so also move the clock when the shown minutes change.
  const nextLabel =
    countdown && countdownUntil !== null
      ? nextMinutesLabelChange((countdownUntil - now) / 60_000)
      : null
  // The countdown moves between polls, so it can reach the warning time
  // before the next poll.
  const warnAt =
    countdownUntil !== null
      ? countdownUntil - RUNWAY_WARNING_MINUTES * 60_000
      : null
  const deadline = fresh
    ? Math.min(
        freshUntil,
        countdown && countdownUntil !== null ? countdownUntil : Infinity,
        countdownUntil !== null && nextLabel !== null
          ? countdownUntil - nextLabel * 60_000
          : Infinity,
        warnAt !== null && now < warnAt ? warnAt : Infinity,
      )
    : null
  useEffect(() => {
    if (deadline === null) return
    const timer = setTimeout(
      () => setClock((current) => ({ ...current, now: Date.now() })),
      deadline - Date.now() + 1,
    )
    return () => clearTimeout(timer)
  }, [deadline])

  const due = warnAt !== null ? now >= warnAt : decision?.show === true
  // Support staff viewing a team do not see the experiment or send its events.
  const eligible = scope === "self" && due
  const flagOn = useFeatureFlagOn(TRIAL_RUNWAY_WARNING_FLAG, eligible)
  const show = eligible && flagOn && reading !== null && teamKey !== null

  const canManage = summary?.permissions.can_manage === true

  // The minutes the countdown shows at a time, or null when it shows none.
  const minutesAt = (at: number) =>
    countdownUntil !== null && at <= freshUntil && at < countdownUntil
      ? (countdownUntil - at) / 60_000
      : null

  const [region, teamId] = teamKey?.split(":", 2) ?? [null, null]
  const properties = {
    team_id: teamId ?? null,
    region: region ?? null,
    remaining_usd: round(reading?.remainingUsd ?? null, 6),
    threshold_mode: decision?.mode ?? null,
    threshold_minutes: RUNWAY_WARNING_MINUTES,
    threshold_usd: FIXED_WARNING_USD,
    minutes_left: round(minutesAt(now), 1),
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
        canManage ? (
          <TrialUpgradeAction
            onAction={(target) =>
              captureBestEffort(posthog, TRIAL_RUNWAY_EVENTS.WARNING_CLICKED, {
                ...properties,
                minutes_left: round(minutesAt(Date.now()), 1),
                target,
              })
            }
          />
        ) : null
      }
    >
      {countdownUntil !== null && countdown ? (
        <>
          At your current usage, your free trial credit runs out in{" "}
          <strong>{formatMinutesLeft((countdownUntil - now) / 60_000)}</strong>.
        </>
      ) : (
        <>Your free trial credit is almost used up.</>
      )}{" "}
      When it runs out, your running sandboxes stop.{" "}
      {canManage
        ? "Upgrade to a paid plan to keep them running."
        : "Ask your team's billing administrator to upgrade."}
    </BannerShell>
  )
}
