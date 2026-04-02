import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import type { Credentials } from "../api/types"
import { AUTH_FILE } from "./constants"

export function saveApiKey(apiKey: string): void {
  const dir = dirname(AUTH_FILE)
  mkdirSync(dir, { recursive: true })
  const creds: Credentials = { api_key: apiKey }
  const tmp = `${AUTH_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 })
  renameSync(tmp, AUTH_FILE)
}

export function getApiKey(): string | null {
  // Environment variable takes precedence
  const envKey = process.env.SUPERSERVE_API_KEY
  if (envKey) return envKey

  if (!existsSync(AUTH_FILE)) return null
  try {
    const text = readFileSync(AUTH_FILE, "utf-8")
    const data = JSON.parse(text)
    if (!data.api_key || typeof data.api_key !== "string") {
      try {
        unlinkSync(AUTH_FILE)
      } catch {}
      return null
    }
    return data.api_key
  } catch {
    try {
      unlinkSync(AUTH_FILE)
    } catch {}
    return null
  }
}

export function clearCredentials(): void {
  if (existsSync(AUTH_FILE)) {
    unlinkSync(AUTH_FILE)
  }
}

export function isAuthenticated(): boolean {
  return getApiKey() !== null
}
