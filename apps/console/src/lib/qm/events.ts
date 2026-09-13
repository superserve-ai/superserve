import type { QmTenantEvent, QmTenantEventStatus } from "@/lib/api/types"

/**
 * qm-api records bookkeeping under pseudo-steps that are not part of the
 * plan: `model_key` (storing the provider key at create time), `trigger`
 * (queuing a run; carries `detail.mode`) and `run` (the worker's attempt:
 * `started` with `detail.mode`, then `ok`/`failed` with a user-safe
 * message). Real steps sit inside a run. A retry queues a new attempt and a
 * teardown replays the same step names in reverse, so the step list is
 * always built from the latest attempt only — bounded by the most recent
 * `trigger started` or `run started`, whichever came last.
 */
export const RUN_STEP = "run"
export const TRIGGER_STEP = "trigger"
export const MODEL_KEY_STEP = "model_key"

const BOOKKEEPING_STEPS: ReadonlySet<string> = new Set([
  RUN_STEP,
  TRIGGER_STEP,
  MODEL_KEY_STEP,
])

/** Events that open a new attempt. */
function isAttemptStart(event: QmTenantEvent): boolean {
  return (
    (event.step === RUN_STEP || event.step === TRIGGER_STEP) &&
    event.status === "started"
  )
}

export type RunMode = "provision" | "deprovision"

/** One row in the step list: a step's events folded into its latest status. */
export interface TenantStep {
  step: string
  label: string
  status: QmTenantEventStatus
  message: string | null
  startedAt: string | null
  endedAt: string | null
}

export interface TenantRun {
  /** Which plan the latest attempt executes; null before any attempt. */
  mode: RunMode | null
  steps: TenantStep[]
  /**
   * The user-safe message from the attempt's bookkeeping failure (run,
   * trigger or model-key), falling back to the failed step's message.
   */
  failureMessage: string | null
}

const PROVISION_LABELS: Record<string, string> = {
  database: "Create database",
  service_account: "Create service account",
  bucket: "Create storage bucket",
  secrets: "Store secrets",
  cloud_run: "Deploy QM",
  load_balancer: "Configure load balancer",
  health_check: "Health check",
  smoke: "Smoke test",
  admin_link: "Prepare admin sign-in",
}

const DEPROVISION_LABELS: Record<string, string> = {
  database: "Delete database",
  service_account: "Remove service account",
  bucket: "Delete storage bucket",
  secrets: "Delete secrets",
  cloud_run: "Remove QM deployment",
  load_balancer: "Remove load balancer",
  health_check: "Health check",
  smoke: "Smoke test",
  admin_link: "Admin sign-in",
}

/** Human label for a step in the given mode; unknown steps are humanized. */
export function stepLabel(step: string, mode: RunMode | null = null): string {
  const known =
    mode === "deprovision" ? DEPROVISION_LABELS[step] : PROVISION_LABELS[step]
  if (known) return known
  const words = step.replace(/[_-]+/g, " ").trim()
  return words ? words[0].toUpperCase() + words.slice(1) : step
}

const TERMINAL: ReadonlySet<QmTenantEventStatus> = new Set([
  "ok",
  "failed",
  "skipped",
])

function chronological(events: QmTenantEvent[]): QmTenantEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .toSorted(
      (a, b) =>
        Date.parse(a.event.at) - Date.parse(b.event.at) || a.index - b.index,
    )
    .map(({ event }) => event)
}

function parseMode(event: QmTenantEvent): RunMode | null {
  const detailMode = event.detail?.mode
  if (detailMode === "provision" || detailMode === "deprovision")
    return detailMode
  if (event.message?.startsWith("deprovision")) return "deprovision"
  if (event.message?.startsWith("provision")) return "provision"
  return null
}

/**
 * Group an event stream by `step`, in order of first appearance. The latest
 * event decides the step's status; the last `started` and the latest
 * terminal event after it bound the duration. Bookkeeping pseudo-steps are
 * never listed.
 */
export function groupTenantEvents(
  events: QmTenantEvent[],
  mode: RunMode | null = null,
): TenantStep[] {
  const steps = new Map<string, TenantStep>()
  for (const event of chronological(events)) {
    if (BOOKKEEPING_STEPS.has(event.step)) continue
    const existing = steps.get(event.step)
    if (!existing) {
      steps.set(event.step, {
        step: event.step,
        label: stepLabel(event.step, mode),
        status: event.status,
        message: event.message || null,
        startedAt: event.status === "started" ? event.at : null,
        endedAt: TERMINAL.has(event.status) ? event.at : null,
      })
      continue
    }
    existing.status = event.status
    if (event.message) existing.message = event.message
    if (event.status === "started") {
      // A re-run of the step: reset its clock.
      existing.startedAt = event.at
      existing.endedAt = null
    } else if (TERMINAL.has(event.status)) {
      existing.endedAt = event.at
    }
  }
  return [...steps.values()]
}

/**
 * The latest attempt: everything from the most recent attempt-opening event
 * onward. A queued retry or deletion is therefore its own (still empty)
 * attempt even before the worker's `run started` arrives, and a trigger
 * that failed to start is reported as that attempt's failure. Streams with
 * no marker at all (a tenant whose key storage failed, or older records)
 * are treated as a single provisioning attempt.
 */
export function latestRun(events: QmTenantEvent[]): TenantRun {
  const ordered = chronological(events)
  const start = ordered.findLastIndex(isAttemptStart)
  const scoped = start === -1 ? ordered : ordered.slice(start)
  const mode = start === -1 ? null : parseMode(ordered[start])
  const steps = groupTenantEvents(scoped, mode)

  const bookkeepingFailure = scoped.findLast(
    (e) =>
      BOOKKEEPING_STEPS.has(e.step) && e.status === "failed" && !!e.message,
  )
  const stepFailure = steps.findLast((s) => s.status === "failed")
  return {
    mode,
    steps,
    failureMessage: bookkeepingFailure?.message ?? stepFailure?.message ?? null,
  }
}

/** Elapsed ms for a step, live for steps still running. */
export function stepElapsedMs(step: TenantStep, now: number): number | null {
  if (!step.startedAt) return null
  const start = Date.parse(step.startedAt)
  const end = step.endedAt ? Date.parse(step.endedAt) : now
  return Math.max(0, end - start)
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s"
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}
