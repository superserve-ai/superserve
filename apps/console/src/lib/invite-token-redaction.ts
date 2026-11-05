import type { CapturedNetworkRequest, CaptureResult, PostHog } from "posthog-js"

import { redactPreviewToken } from "@/lib/preview-token-redaction"

// An invitation token is a bearer credential for a team Owner seat, so it must
// never reach analytics. Tokens travel in the /invite/<token> path and, through
// sign-up, inside a `next=` query parameter. Any token character can appear raw
// or percent-encoded, with multiple encoding layers; URL separators stay intact.
export const REDACTED_INVITE_TOKEN = "ssinv_redacted"

// ASCII letters, digits, "_" and "-", with any number of extra %25 layers.
const ENCODED_UNDERSCORE = "%(?:25)*5[Ff]"
const ENCODED_BODY_CHAR =
  "%(?:25)*(?:[46][1-9A-Fa-f]|[57][0-9Aa]|3[0-9]|5[Ff]|2[Dd])"
const BODY_CHAR = `(?:[A-Za-z0-9_-]|${ENCODED_BODY_CHAR})`
const TOKEN = new RegExp(`ssinv(?:_|${ENCODED_UNDERSCORE})${BODY_CHAR}+`, "gi")

// Whatever sits in the segment after /invite/ is treated as a token, so a
// spelling the pattern above does not recognise (including encoded prefix
// letters) is still removed from the path.
const SLASH = "(?:/|%(?:25)*2[Ff])"
const INVITE_SEGMENT = new RegExp(
  `(${SLASH}invite${SLASH})(?:[^/?#&%\\s"'<>]|${ENCODED_BODY_CHAR})+`,
  "gi",
)

const MIGHT_CONTAIN = /ssinv|invite/i
const MAX_DEPTH = 80

export function redactInviteTokens(text: string): string {
  if (!MIGHT_CONTAIN.test(text)) return text
  return text
    .replace(TOKEN, REDACTED_INVITE_TOKEN)
    .replace(INVITE_SEGMENT, `$1${REDACTED_INVITE_TOKEN}`)
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Redacts every string inside a JSON-like value (plain objects and arrays).
 * Returns the input itself when nothing changed, and never mutates it.
 */
export function redactInviteTokensDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return redactInviteTokens(value) as T
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return value

  if (Array.isArray(value)) {
    let copy: unknown[] | null = null
    for (let i = 0; i < value.length; i++) {
      const next = redactInviteTokensDeep(value[i], depth + 1)
      if (next !== value[i]) {
        copy ??= value.slice()
        copy[i] = next
      }
    }
    return (copy ?? value) as T
  }

  if (!isPlainObject(value)) return value
  let copy: Record<string, unknown> | null = null
  for (const key of Object.keys(value)) {
    const next = redactInviteTokensDeep(value[key], depth + 1)
    if (next !== value[key]) {
      copy ??= { ...value }
      copy[key] = next
    }
  }
  return (copy ?? value) as T
}

// /flags bypasses before_send and expands these persisted attribution values.
export function scrubPersistedInviteTokens(
  posthog: Pick<PostHog, "get_property" | "register">,
): void {
  for (const key of [
    "$initial_person_info",
    "$initial_referrer_info",
    "$initial_campaign_params",
  ]) {
    const value = posthog.get_property(key)
    const redacted = redactInviteTokensDeep(value)
    if (redacted !== value) posthog.register({ [key]: redacted })
  }
}

/**
 * PostHog `before_send` hook: the last stop for every event, covering
 * $current_url, $pathname, $referrer, the $initial_* person properties,
 * autocapture element hrefs and session-recording snapshots.
 */
export function redactInviteTokensFromEvent(
  event: CaptureResult | null,
): CaptureResult | null {
  return event ? redactInviteTokensDeep(event) : event
}

/** Session-recording network metadata: invite tokens, then preview tokens. */
export function redactCapturedRequest(
  request: CapturedNetworkRequest,
): CapturedNetworkRequest {
  const name = redactInviteTokens(request.name)
  return redactPreviewToken(
    name === request.name ? request : { ...request, name },
  )
}

/** True when an address (path, query or full URL) carries an invite token. */
export function carriesInviteToken(address: string): boolean {
  return redactInviteTokens(address) !== address
}

// The recorder serialises a link's href as soon as it renders, before the
// asynchronous pause below can take effect, so a token link opts out with the
// recorder's block class.
export function inviteLinkReplayClass(href: string): string | undefined {
  return carriesInviteToken(href) ? "ph-no-capture" : undefined
}

interface RecordingControls {
  startSessionRecording(): void
  stopSessionRecording(): void
}

let pausedForInvite = false

/**
 * The recorder does not accept a client-side URL blocklist and compresses its
 * snapshots before `before_send` sees them, so a page whose address holds a
 * token is kept out of the recording by pausing it there and resuming after.
 */
export function syncRecordingWithAddress(
  posthog: RecordingControls,
  address: string,
): void {
  if (carriesInviteToken(address)) {
    // Also valid before the recorder has started: it sets
    // disable_session_recording, so the later remote-config start is a no-op.
    posthog.stopSessionRecording()
    pausedForInvite = true
    return
  }
  if (pausedForInvite) {
    pausedForInvite = false
    posthog.startSessionRecording()
  }
}
