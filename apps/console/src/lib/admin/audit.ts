import { trackEvent } from "@/lib/posthog/actions"
import { ADMIN_EVENTS } from "@/lib/posthog/events"
import sendToSlackHook from "@/lib/slack/send-to-webhook"

type ImpersonationEvent = {
  action: "start" | "stop"
  adminId: string
  adminEmail: string
  teamId: string
  teamName?: string
}

/** Per-individual, non-blocking audit. Never throws. */
export async function logImpersonationEvent(
  e: ImpersonationEvent,
): Promise<void> {
  console.info(
    "[admin-impersonation]",
    JSON.stringify({ ...e, ts: new Date().toISOString() }),
  )

  // Attribute to the individual admin so the event stream is per-person.
  try {
    await trackEvent(
      e.action === "start"
        ? ADMIN_EVENTS.IMPERSONATION_STARTED
        : ADMIN_EVENTS.IMPERSONATION_STOPPED,
      e.adminId,
      { admin_email: e.adminEmail, team_id: e.teamId, team_name: e.teamName },
    )
  } catch {
    // PostHog is best-effort; the structured log above is the source of truth.
  }

  try {
    const verb =
      e.action === "start" ? "started impersonating" : "stopped impersonating"
    await sendToSlackHook({
      text: `:detective: ${e.adminEmail} ${verb} team ${e.teamName ?? e.teamId}`,
    })
  } catch {
    // Slack is best-effort; the structured log above is the source of truth.
  }
}
