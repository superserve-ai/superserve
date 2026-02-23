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

export function saveCredentials(creds: Credentials): void {
  const dir = dirname(AUTH_FILE)
  mkdirSync(dir, { recursive: true })
  const tmp = `${AUTH_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 })
  renameSync(tmp, AUTH_FILE)
}

export function getCredentials(): Credentials | null {
  if (!existsSync(AUTH_FILE)) return null
  try {
    const text = readFileSync(AUTH_FILE, "utf-8")
    const data = JSON.parse(text)
    if (!data.token || typeof data.token !== "string") {
      try {
        unlinkSync(AUTH_FILE)
      } catch {}
      return null
    }
    return data as Credentials
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
  return getCredentials() !== null
}
