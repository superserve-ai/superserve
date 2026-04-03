/* eslint-disable no-var */
declare const __SDK_VERSION__: string
declare var process: { env: Record<string, string | undefined> } | undefined
declare var Bun: unknown

const POSTHOG_KEY = "phc_gjpDKKKQJAnkxkqLrPGrAhoariKsaHNuTpI5rVhkYre"
const POSTHOG_URL = "https://us.i.posthog.com/capture/"

let _disabled: boolean | null = null
const _distinctId =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

function isDisabled(): boolean {
  if (_disabled === null) {
    const env =
      typeof process !== "undefined" && process?.env
        ? process.env
        : ({} as Record<string, string | undefined>)
    _disabled =
      env.DO_NOT_TRACK === "1" ||
      env.SUPERSERVE_DO_NOT_TRACK === "1" ||
      env.SUPERSERVE_TELEMETRY === "0"
  }
  return _disabled
}

function getRuntime(): string {
  try {
    if (typeof Bun !== "undefined") return "bun"
  } catch {}
  return "node"
}

/**
 * Fire-and-forget telemetry event. Never throws, never blocks.
 * Respects DO_NOT_TRACK and SUPERSERVE_DO_NOT_TRACK env vars.
 */
export function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (isDisabled()) return
  try {
    const version =
      typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "unknown"
    fetch(POSTHOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: _distinctId,
        properties: {
          sdk: "typescript",
          sdk_version: version,
          runtime: getRuntime(),
          ...properties,
        },
      }),
    }).catch(() => {})
  } catch {
    // Never throw from telemetry
  }
}
