import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { arch, platform } from "node:os"
import { join } from "node:path"

import { configDir, VERSION } from "./config"

// One anonymous event per run: command path, exit code, duration. Never arguments,
// IDs, paths or output. Opt out with SUPERSERVE_TELEMETRY=0 or DO_NOT_TRACK=1.

const POSTHOG_URL = "https://us.i.posthog.com/capture/"
const POSTHOG_KEY = "phc_gjpDKKKQJAnkxkqLrPGrAhoariKsaHNuTpI5rVhkYre"
// The event goes out after the command finished; never hold the shell longer.
const SEND_BUDGET_MS = 400

function disabled(): boolean {
  const t = process.env.SUPERSERVE_TELEMETRY
  return (
    t === "0" ||
    t === "false" ||
    Boolean(process.env.DO_NOT_TRACK) ||
    // Opt-outs from earlier CLI versions keep working.
    Boolean(process.env.SUPERSERVE_DO_NOT_TRACK) ||
    existsSync(join(configDir(), ".analytics_disabled"))
  )
}

function anonymousId(): string {
  const file = join(configDir(), "anonymous_id")
  try {
    const id = readFileSync(file, "utf8").trim()
    if (id) return id
  } catch {}
  const id = crypto.randomUUID()
  try {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 })
    writeFileSync(file, id, { mode: 0o600 })
  } catch {}
  return id
}

export async function recordCommand(
  command: string,
  exitCode: number,
  durationMs: number,
): Promise<void> {
  if (disabled()) return
  try {
    await fetch(POSTHOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: "cli_command",
        distinct_id: anonymousId(),
        properties: {
          command,
          exit_code: exitCode,
          duration_ms: Math.round(durationMs),
          cli_version: VERSION,
          os: platform(),
          arch: arch(),
          runtime: process.versions.bun ? "bun" : "node",
          ci: Boolean(process.env.CI),
          $process_person_profile: false,
        },
      }),
      signal: AbortSignal.timeout(SEND_BUDGET_MS),
    })
  } catch {
    // Telemetry never affects the command.
  }
}
