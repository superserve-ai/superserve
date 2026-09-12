import type { QmTenantEvent, QmTenantEventStatus } from "@/lib/api/types"

/**
 * One row in the provisioning step list: every event for a `step` folded
 * into its latest status, plus how long the step took (or has been running).
 */
export interface TenantStep {
  step: string
  label: string
  status: QmTenantEventStatus
  message: string | null
  startedAt: string | null
  endedAt: string | null
}

/** Human labels for the steps qm-api emits; unknown steps are humanized. */
const STEP_LABELS: Record<string, string> = {
  validate_model_key: "Validate model key",
  validate_key: "Validate model key",
  reserve_slug: "Reserve subdomain",
  create_database: "Create database",
  create_db: "Create database",
  create_secrets: "Store secrets",
  deploy: "Deploy QM",
  deploy_stack: "Deploy QM",
  configure_dns: "Configure DNS",
  dns: "Configure DNS",
  issue_certificate: "Issue TLS certificate",
  tls: "Issue TLS certificate",
  health_check: "Health check",
  healthcheck: "Health check",
  seed_admin: "Create admin account",
  create_admin: "Create admin account",
  send_invite: "Send admin sign-in email",
  teardown: "Tear down stack",
  drop_database: "Delete database",
  release_slug: "Release subdomain",
}

export function stepLabel(step: string): string {
  const known = STEP_LABELS[step]
  if (known) return known
  const words = step.replace(/[_-]+/g, " ").trim()
  return words ? words[0].toUpperCase() + words.slice(1) : step
}

const TERMINAL: ReadonlySet<QmTenantEventStatus> = new Set([
  "ok",
  "failed",
  "skipped",
])

/**
 * Group an event stream by `step`, in order of first appearance. The latest
 * event (by `at`, then stream order) decides the step's status; the first
 * `started` and the latest terminal event bound its duration.
 */
export function groupTenantEvents(events: QmTenantEvent[]): TenantStep[] {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .toSorted(
      (a, b) =>
        Date.parse(a.event.at) - Date.parse(b.event.at) || a.index - b.index,
    )
    .map(({ event }) => event)

  const steps = new Map<string, TenantStep>()
  for (const event of ordered) {
    const existing = steps.get(event.step)
    if (!existing) {
      steps.set(event.step, {
        step: event.step,
        label: stepLabel(event.step),
        status: event.status,
        message: event.message,
        startedAt: event.status === "started" ? event.at : null,
        endedAt: TERMINAL.has(event.status) ? event.at : null,
      })
      continue
    }
    existing.status = event.status
    if (event.message) existing.message = event.message
    if (event.status === "started") {
      // A retry re-runs the step: reset its clock.
      existing.startedAt = event.at
      existing.endedAt = null
    } else if (TERMINAL.has(event.status)) {
      existing.endedAt = event.at
    }
  }
  return [...steps.values()]
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

/** The message of the most recent failed event, if any. */
export function latestFailureMessage(events: QmTenantEvent[]): string | null {
  const failed = groupTenantEvents(events).findLast(
    (s) => s.status === "failed",
  )
  return failed?.message ?? null
}
