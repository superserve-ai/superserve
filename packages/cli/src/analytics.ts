import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { arch, platform } from "node:os"
import { join } from "node:path"
import type { PostHog } from "posthog-node"
import { CLI_VERSION, SUPERSERVE_CONFIG_DIR } from "./config/constants"

const POSTHOG_API_KEY =
  process.env.SUPERSERVE_POSTHOG_KEY ??
  "phc_gjpDKKKQJAnkxkqLrPGrAhoariKsaHNuTpI5rVhkYre"
const POSTHOG_HOST = "https://us.i.posthog.com"

const ANONYMOUS_ID_FILE = join(SUPERSERVE_CONFIG_DIR, "anonymous_id")
const ANALYTICS_DISABLED_FILE = join(
  SUPERSERVE_CONFIG_DIR,
  ".analytics_disabled",
)

const DEFAULT_PROPERTIES: Record<string, unknown> = {
  cli_version: CLI_VERSION,
  os: platform(),
  arch: arch(),
  node_version: process.version,
}

function isDisabled(): boolean {
  if (existsSync(ANALYTICS_DISABLED_FILE)) return true
  return Boolean(
    process.env.SUPERSERVE_DO_NOT_TRACK || process.env.DO_NOT_TRACK,
  )
}

function getAnonymousId(): string {
  mkdirSync(SUPERSERVE_CONFIG_DIR, { recursive: true })

  if (existsSync(ANONYMOUS_ID_FILE)) {
    return readFileSync(ANONYMOUS_ID_FILE, "utf-8").trim()
  }

  const anonymousId = randomUUID()
  writeFileSync(ANONYMOUS_ID_FILE, anonymousId, { mode: 0o600 })
  return anonymousId
}

// Lazy PostHog singleton
let posthogInstance: PostHog | null = null

async function getPostHog(): Promise<PostHog> {
  if (!posthogInstance) {
    const { PostHog } = await import("posthog-node")
    posthogInstance = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
    })
  }
  return posthogInstance
}

/**
 * Link the anonymous device ID to the real user after login.
 * Calls PostHog identify so all past and future events merge under one profile.
 */
export async function identify(user: {
  id: string
  email: string
  full_name?: string | null
}): Promise<void> {
  if (isDisabled()) return

  try {
    const posthog = await getPostHog()
    const anonymousId = getAnonymousId()

    // Set the real user ID as distinct ID going forward
    posthog.identify({
      distinctId: user.id,
      properties: {
        email: user.email,
        name: user.full_name ?? undefined,
        ...DEFAULT_PROPERTIES,
      },
    })

    // Merge the anonymous device ID into the real user profile
    posthog.alias({
      distinctId: user.id,
      alias: anonymousId,
    })

    // Persist user ID so subsequent track() calls use the real ID
    const userIdFile = join(SUPERSERVE_CONFIG_DIR, "analytics_user_id")
    writeFileSync(userIdFile, user.id, { mode: 0o600 })
  } catch {
    // Fail silently
  }
}

function getDistinctId(): string {
  // Prefer real user ID if identified, fall back to anonymous ID
  const userIdFile = join(SUPERSERVE_CONFIG_DIR, "analytics_user_id")
  try {
    if (existsSync(userIdFile)) {
      const userId = readFileSync(userIdFile, "utf-8").trim()
      if (userId) return userId
    }
  } catch {
    // Fall through to anonymous ID
  }
  return getAnonymousId()
}

export async function track(
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (isDisabled()) return

  try {
    const posthog = await getPostHog()
    posthog.capture({
      distinctId: getDistinctId(),
      event,
      properties: { ...DEFAULT_PROPERTIES, ...properties },
    })
  } catch {
    // Fail silently — analytics should never break the CLI
  }
}

/**
 * Clear stored user identity on logout, reverting to anonymous tracking.
 */
export function resetIdentity(): void {
  const userIdFile = join(SUPERSERVE_CONFIG_DIR, "analytics_user_id")
  try {
    if (existsSync(userIdFile)) unlinkSync(userIdFile)
  } catch {
    // Fail silently
  }
}

export async function flushAnalytics(): Promise<void> {
  if (!posthogInstance) return
  const client = posthogInstance
  posthogInstance = null
  try {
    await client.shutdown()
  } catch {
    // Fail silently
  }
}

// Ensure analytics flush even on early process.exit() calls
let exitHookRegistered = false
export function registerExitHook(): void {
  if (exitHookRegistered) return
  exitHookRegistered = true
  process.on("beforeExit", async () => {
    await flushAnalytics()
  })
}
