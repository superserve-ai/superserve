import { after } from "next/server"

import { SIGNUP_RESTRICTED_MESSAGE } from "@/lib/auth/signup-restricted-message"
import { cellFor } from "@/lib/cells"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"

export { SIGNUP_RESTRICTED_MESSAGE }

export class SignupRestrictedError extends Error {
  constructor() {
    super(SIGNUP_RESTRICTED_MESSAGE)
    this.name = "SignupRestrictedError"
  }
}

type Decision = {
  mode: "off" | "observe" | "enforce"
  decision: "allowed" | "would_deny" | "blocked"
  matched_subject_type: "none" | "fingerprint"
}

const MAX_RESPONSE_BYTES = 4096

async function boundedDecision(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("empty response")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("oversized response")
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

function validDecision(value: unknown): value is Decision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const d = value as Record<string, unknown>
  if (Object.keys(d).length !== 3) return false
  return (
    (d.mode === "off" &&
      d.decision === "allowed" &&
      d.matched_subject_type === "none") ||
    (d.mode === "observe" &&
      ((d.decision === "allowed" && d.matched_subject_type === "none") ||
        (d.decision === "would_deny" &&
          d.matched_subject_type === "fingerprint"))) ||
    (d.mode === "enforce" &&
      ((d.decision === "allowed" && d.matched_subject_type === "none") ||
        (d.decision === "blocked" && d.matched_subject_type === "fingerprint")))
  )
}

function record(actor: string, properties: Record<string, string>) {
  try {
    after(async () => {
      try {
        await trackEvent(
          AUTH_EVENTS.SIGNUP_RESTRICTION_EVALUATED,
          actor,
          properties,
        )
      } catch {
        // Telemetry cannot alter decisions.
      }
    })
  } catch {
    // Telemetry cannot alter decisions.
  }
}

/** Only the backend's valid blocked response can stop provisioning. */
export async function evaluateSignupRestriction(
  region: string,
  actor: string,
  visitor: string | null,
): Promise<void> {
  if (!visitor) {
    record(actor, { outcome: "allowed", mode: "unknown", subject_type: "none" })
    return
  }
  if (Buffer.byteLength(visitor) > 256) {
    record(actor, {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
    return
  }
  const token =
    region === "use"
      ? process.env.INTERNAL_API_TOKEN
      : region === "usw"
        ? process.env.INTERNAL_API_TOKEN_USWEST
        : undefined
  if (!token) {
    record(actor, {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
    return
  }
  try {
    const response = await fetch(
      new URL("/internal/signup/evaluate", cellFor(region).apiBaseUrl),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subjects: [{ type: "fingerprint", value: visitor }],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(1500),
      },
    )
    if (!response.ok) throw new Error("status")
    const decision = await boundedDecision(response)
    if (!validDecision(decision)) throw new Error("schema")
    record(actor, {
      outcome: decision.decision,
      mode: decision.mode,
      subject_type: decision.matched_subject_type,
    })
    if (decision.decision === "blocked") throw new SignupRestrictedError()
  } catch (error) {
    if (error instanceof SignupRestrictedError) throw error
    record(actor, {
      outcome: "unavailable",
      mode: "unknown",
      subject_type: "none",
    })
  }
}
