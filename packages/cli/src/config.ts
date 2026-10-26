import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { resolveConfig, type ResolvedConfig } from "@superserve/sdk"

import pkg from "../package.json"
import { CliError, EXIT } from "./errors"

export const VERSION: string = pkg.version
export const USER_AGENT = `superserve-cli/${VERSION}`
export const CONSOLE_URL =
  process.env.SUPERSERVE_CONSOLE_URL ?? "https://console.superserve.ai"

// Read per call, not at import, so SUPERSERVE_CONFIG_DIR always applies.
export function configDir(): string {
  return process.env.SUPERSERVE_CONFIG_DIR || join(homedir(), ".superserve")
}

function credentialsFile(): string {
  return join(configDir(), "credentials.json")
}

export interface StoredCredentials {
  api_key: string
  /** Control-plane override saved by `login --base-url`. */
  base_url?: string
  /** Set by a browser signup: until then the new account may still be setting up billing. */
  setup_until?: number
}

export function readCredentials(): StoredCredentials | null {
  try {
    const data = JSON.parse(readFileSync(credentialsFile(), "utf8"))
    return typeof data?.api_key === "string" && data.api_key
      ? (data as StoredCredentials)
      : null
  } catch {
    return null
  }
}

export function writeCredentials(creds: StoredCredentials): string {
  const file = credentialsFile()
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, file)
  // writeFileSync's mode only applies on create; tighten a pre-existing file too.
  chmodSync(file, 0o600)
  return file
}

export function clearCredentials(): boolean {
  const had = readCredentials() !== null
  rmSync(credentialsFile(), { force: true })
  return had
}

export type KeySource = "env" | "credentials"

export interface Connection extends ResolvedConfig {
  source: KeySource
}

let cached: Connection | undefined

/** Forget the resolved connection (each in-process CLI run starts fresh). */
export function resetConnection(): void {
  cached = undefined
}

/** Env vars win over saved credentials, so CI never needs a login; the SDK derives region endpoints from the key. */
export function connection(): Connection {
  if (cached) return cached
  const envKey = process.env.SUPERSERVE_API_KEY?.trim()
  const stored = envKey ? null : readCredentials()
  const apiKey = envKey || stored?.api_key
  if (!apiKey) {
    throw new CliError(
      "Not logged in.",
      EXIT.AUTH,
      "Run `superserve login`, or set SUPERSERVE_API_KEY.",
      "not_logged_in",
    )
  }
  const baseUrl =
    process.env.SUPERSERVE_BASE_URL?.trim() || stored?.base_url || undefined
  cached = {
    ...resolveConfig({ apiKey, baseUrl }),
    source: envKey ? "env" : "credentials",
  }
  return cached
}

/** Options every SDK call takes, so the SDK sees the same key and endpoints. */
export function sdkOptions(): { apiKey: string; baseUrl: string } {
  const c = connection()
  return { apiKey: c.apiKey, baseUrl: c.baseUrl }
}

/** `ss_live_use_AbCd…`: enough to tell keys apart, never the secret part. */
export function maskKey(key: string): string {
  const region = regionOf(key)
  const prefix = region ? `ss_live_${region}_` : "ss_live_"
  return key.startsWith(prefix)
    ? `${key.slice(0, prefix.length + 4)}…`
    : `${key.slice(0, 4)}…`
}

// Same shape the SDK uses: a region segment only counts when the full
// 32-char random tail follows it, so a legacy key's tail is never misread.
export function regionOf(key: string): string | undefined {
  return /^ss_live_([a-z0-9]{1,17})_[A-Za-z0-9_-]{32}$/.exec(key)?.[1]
}
