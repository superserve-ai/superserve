import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { ActivatedSandbox } from "./api"
import { configDir, connection } from "./config"

// Reused for 50 minutes: access tokens stay valid at least an hour and routing
// hints exactly one. A stale entry costs one failed dial, then callers activate.

const REUSE_MS = 50 * 60_000

interface Entry {
  access_token: string
  routing_hint?: string
  at: number
}

function file(): string {
  return join(configDir(), "tokens.json")
}

// Entries are scoped to the API key, so switching keys never reuses a token.
function keyFor(sandboxId: string): string {
  const k = createHash("sha256").update(connection().apiKey).digest("hex")
  return `${k.slice(0, 16)}:${sandboxId}`
}

function load(): Record<string, Entry> {
  try {
    return JSON.parse(readFileSync(file(), "utf8"))
  } catch {
    return {}
  }
}

function save(entries: Record<string, Entry>): void {
  try {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 })
    const tmp = `${file()}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 })
    renameSync(tmp, file())
  } catch {
    // A cache that can't be written just means the next call activates.
  }
}

export function cachedToken(
  sandboxId: string,
): Pick<ActivatedSandbox, "access_token" | "routing_hint"> | undefined {
  const e = load()[keyFor(sandboxId)]
  return e && Date.now() - e.at < REUSE_MS ? e : undefined
}

export function rememberToken(sandboxId: string, a: ActivatedSandbox): void {
  const now = Date.now()
  const entries = Object.fromEntries(
    Object.entries(load()).filter(([, e]) => now - e.at < REUSE_MS),
  )
  entries[keyFor(sandboxId)] = {
    access_token: a.access_token,
    routing_hint: a.routing_hint,
    at: now,
  }
  save(entries)
}

export function forgetToken(sandboxId: string): void {
  const entries = load()
  if (delete entries[keyFor(sandboxId)]) save(entries)
}
