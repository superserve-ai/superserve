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
