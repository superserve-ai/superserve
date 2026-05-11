/**
 * Persistence for terminal tab metadata (id + display name).
 *
 * Only the list shape is persisted — the active tab is page-session state and
 * each tab gets a fresh shell on reload. Storage is cleared on sign-out.
 */

const STORAGE_KEY = "superserve.terminal-tabs"

export interface PersistedTerminalTab {
  id: string
  name: string
}

const MAX_NAME_LENGTH = 64
const MAX_TABS = 10

function isValidTab(value: unknown): value is PersistedTerminalTab {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    candidate.name.length <= MAX_NAME_LENGTH
  )
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadTerminalTabs(): PersistedTerminalTab[] | null {
  const storage = safeStorage()
  if (!storage) return null

  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    storage.removeItem(STORAGE_KEY)
    return null
  }

  if (!Array.isArray(parsed)) {
    storage.removeItem(STORAGE_KEY)
    return null
  }

  const tabs = parsed.filter(isValidTab).slice(0, MAX_TABS)
  return tabs.length > 0 ? tabs : null
}

export function saveTerminalTabs(tabs: PersistedTerminalTab[]): void {
  const storage = safeStorage()
  if (!storage) return
  try {
    const trimmed = tabs.slice(0, MAX_TABS).map((tab) => ({
      id: tab.id,
      name: tab.name.slice(0, MAX_NAME_LENGTH),
    }))
    storage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Quota exceeded or storage disabled — silently ignore; the worst case
    // is that tab names don't survive a reload.
  }
}

export function clearTerminalTabsStorage(): void {
  const storage = safeStorage()
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore — there's nothing meaningful to do on cleanup failure.
  }
}

export const TERMINAL_TABS_STORAGE_KEY = STORAGE_KEY
export const TERMINAL_TABS_MAX_NAME_LENGTH = MAX_NAME_LENGTH
export const TERMINAL_TABS_MAX_COUNT = MAX_TABS
