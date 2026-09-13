import type { QmTenantEvent, QmTenantEventStatus } from "@/lib/api/types"

/**
 * qm-api records every attempt under a pseudo-step, `run`: a `started` event
 * (with `detail.mode`) opens it, and an `ok` or `failed` event with a
 * user-safe message closes it. Real steps sit in between. A retry opens a
 * new run, and a teardown replays the same step names in reverse — so the
 * step list is always built from the latest run only.
 */
export const RUN_STEP = "run"

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
  /** Which plan the latest run executes; null before any run has started. */
  mode: RunMode | null
  steps: TenantStep[]
  /** The run's user-safe failure message, or the failed step's message. */
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
 * terminal event after it bound the duration. `run` events are not steps.
 */
export function groupTenantEvents(
  events: QmTenantEvent[],
  mode: RunMode | null = null,
): TenantStep[] {
  const steps = new Map<string, TenantStep>()
  for (const event of chronological(events)) {
    if (event.step === RUN_STEP) continue
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
 * The latest attempt: everything from the most recent `run started` event
 * onward. Streams without a run marker (older records) are treated as one
 * provisioning run.
 */
export function latestRun(events: QmTenantEvent[]): TenantRun {
  const ordered = chronological(events)
  const start = ordered.findLastIndex(
    (e) => e.step === RUN_STEP && e.status === "started",
  )
  const scoped = start === -1 ? ordered : ordered.slice(start)
  const mode = start === -1 ? null : parseMode(ordered[start])
  const steps = groupTenantEvents(scoped, mode)

  const runFailure = scoped.findLast(
    (e) => e.step === RUN_STEP && e.status === "failed" && e.message,
  )
  const stepFailure = steps.findLast((s) => s.status === "failed")
  return {
    mode,
    steps,
    failureMessage: runFailure?.message ?? stepFailure?.message ?? null,
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
