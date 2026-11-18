import type { BillingSummaryResponse } from "@/lib/api/billing"
import type { AwaitingPlanState } from "@/lib/billing/signup-checkout-paths"

// Warn when the trial credit lasts this long or less at the current burn rate.
export const RUNWAY_WARNING_MINUTES = 10
// Before two readings give a burn rate, warn at this balance instead. New
// trials used the $0.05 grant in 23-36 minutes, so $0.02 lasts about 9-14.
export const FIXED_WARNING_USD = 0.02
// Readings closer than this differ mostly by rounding; readings further apart
// average over usage that may have stopped (background tabs do not poll).
const MIN_SAMPLE_MS = 5_000
export const MAX_SAMPLE_MS = 5 * 60_000

export type RunwayMode = "burn_rate" | "fixed"

export interface TrialReading {
  // The server's calculated_at, so browser clock skew and request latency do
  // not change the rate.
  at: number
  remainingUsd: number
}

export interface RunwayTrack {
  team: string
  // The reading the next burn rate is measured from.
  baseline: TrialReading
  // The time of the newest reading the burn rate applies to.
  latestAt: number
  // USD per minute between the last two usable readings; null when unknown.
  burnUsdPerMinute: number | null
}

export interface RunwayDecision {
  show: boolean
  mode: RunwayMode
  minutesLeft: number | null
}

// The balance of a live trial that can still run out, or null. The summary
// computes consumption up to calculated_at, including running sandboxes.
export function trialReading(
  summary: BillingSummaryResponse | undefined,
  entry: AwaitingPlanState | "activating" | null | undefined,
): TrialReading | null {
  const trial = summary?.trial
  if (entry !== "trial" || !summary?.permissions?.can_view || !trial)
    return null
  if (
    summary.trial_block ||
    trial.state !== "active" ||
    trial.eligible === false
  )
    return null
  const remainingUsd = trial.remaining_usd
  const at = Date.parse(summary.calculated_at ?? "")
  if (
    typeof remainingUsd !== "number" ||
    !Number.isFinite(remainingUsd) ||
    remainingUsd <= 0 ||
    !Number.isFinite(at)
  )
    return null
  return { at, remainingUsd }
}

export function burnRate(
  previous: TrialReading,
  next: TrialReading,
): number | null {
  const elapsed = next.at - previous.at
  if (elapsed < MIN_SAMPLE_MS || elapsed > MAX_SAMPLE_MS) return null
  const spent = previous.remainingUsd - next.remainingUsd
  // A balance that went up (a new grant) says nothing about usage.
  if (spent < 0) return null
  return spent / (elapsed / 60_000)
}

// The next track for a reading. It returns the same object when nothing
// changed, so a caller can keep it in state and update it during render.
export function advanceRunway(
  track: RunwayTrack | null,
  team: string | null,
  reading: TrialReading | null,
): RunwayTrack | null {
  if (!team) return null
  if (!reading) return track?.team === team ? track : null
  if (track?.team !== team)
    return {
      team,
      baseline: reading,
      latestAt: reading.at,
      burnUsdPerMinute: null,
    }
  if (reading.at <= track.latestAt) return track
  // A refresh too soon after the baseline keeps the last estimate.
  if (reading.at - track.baseline.at < MIN_SAMPLE_MS)
    return { ...track, latestAt: reading.at }
  return {
    team,
    baseline: reading,
    latestAt: reading.at,
    burnUsdPerMinute: burnRate(track.baseline, reading),
  }
}

export function runwayDecision(
  remainingUsd: number,
  burnUsdPerMinute: number | null,
): RunwayDecision {
  if (!Number.isFinite(remainingUsd) || remainingUsd <= 0)
    return { show: false, mode: "fixed", minutesLeft: null }
  if (burnUsdPerMinute !== null && Number.isFinite(burnUsdPerMinute)) {
    // Nothing is using credit now, so it does not run out.
    if (burnUsdPerMinute <= 0)
      return { show: false, mode: "burn_rate", minutesLeft: null }
    const minutesLeft = remainingUsd / burnUsdPerMinute
    return {
      show: minutesLeft <= RUNWAY_WARNING_MINUTES,
      mode: "burn_rate",
      minutesLeft,
    }
  }
  return {
    show: remainingUsd <= FIXED_WARNING_USD,
    mode: "fixed",
    minutesLeft: null,
  }
}

export function formatMinutesLeft(minutes: number): string {
  if (minutes < 1) return "less than a minute"
  const rounded = Math.round(minutes)
  return rounded === 1 ? "about 1 minute" : `about ${rounded} minutes`
}
