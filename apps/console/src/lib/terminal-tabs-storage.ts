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

/**
 * Per-terminal scrollback persistence.
 *
 * SerializeAddon emits an opaque string that, when written back to a fresh
 * xterm, recreates the visible buffer + scrollback + modes. We persist it
 * keyed by `${sandboxId}:${tabId}` so users keep their context across
 * reloads. The whole pool is capped to keep localStorage well under quota
 * (~5 MB) — we evict LRU when we hit the cap.
 */

const BUFFER_INDEX_KEY = "superserve.terminal-buffers.index"
const BUFFER_PREFIX = "superserve.terminal-buffer."
const MAX_BUFFER_BYTES = 256 * 1024
const MAX_BUFFERS = MAX_TABS

// In-memory tombstone for keys explicitly closed this session. Closing a tab
// runs `closeTab` (state update) → `clearTerminalBuffer` synchronously, but
// the SandboxTerminal unmount cleanup later calls `saveTerminalBuffer` and
// resurrects the buffer. The tombstone makes those later writes a no-op.
// In-memory only — fresh page loads start with an empty set, and tab IDs are
// unique per session so collisions are not a concern.
const tombstonedKeys = new Set<string>()

interface BufferIndexEntry {
  key: string
  size: number
  updatedAt: number
}

function readBufferIndex(storage: Storage): BufferIndexEntry[] {
  try {
    const raw = storage.getItem(BUFFER_INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is BufferIndexEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as BufferIndexEntry).key === "string" &&
        typeof (entry as BufferIndexEntry).size === "number" &&
        typeof (entry as BufferIndexEntry).updatedAt === "number",
    )
  } catch {
    return []
  }
}

function writeBufferIndex(storage: Storage, entries: BufferIndexEntry[]): void {
  try {
    storage.setItem(BUFFER_INDEX_KEY, JSON.stringify(entries))
  } catch {
    // Ignore — buffer persistence is best-effort.
  }
}

export function loadTerminalBuffer(key: string): string | null {
  const storage = safeStorage()
  if (!storage || !key) return null
  try {
    return storage.getItem(BUFFER_PREFIX + key)
  } catch {
    return null
  }
}

export function saveTerminalBuffer(key: string, value: string): void {
  const storage = safeStorage()
  if (!storage || !key) return
  if (tombstonedKeys.has(key)) return
  // Single-buffer cap: drop the whole entry rather than persist a giant blob.
  if (value.length > MAX_BUFFER_BYTES) return

  try {
    let index = readBufferIndex(storage)
    index = index.filter((entry) => entry.key !== key)

    // Evict oldest until we're under the global cap (buffer count + bytes).
    while (
      index.length >= MAX_BUFFERS ||
      index.reduce((sum, e) => sum + e.size, 0) + value.length >
        MAX_BUFFER_BYTES * MAX_BUFFERS
    ) {
      index = index.toSorted((a, b) => a.updatedAt - b.updatedAt)
      const oldest = index.shift()
      if (!oldest) break
      try {
        storage.removeItem(BUFFER_PREFIX + oldest.key)
      } catch {
        // Ignore — best-effort cleanup.
      }
    }

    index.push({ key, size: value.length, updatedAt: Date.now() })
    storage.setItem(BUFFER_PREFIX + key, value)
    writeBufferIndex(storage, index)
  } catch {
    // Quota exceeded — drop the write and clear the index entry to keep
    // metadata consistent.
    try {
      storage.removeItem(BUFFER_PREFIX + key)
    } catch {
      // Ignore — best-effort cleanup.
    }
  }
}

export function clearTerminalBuffer(key: string): void {
  const storage = safeStorage()
  if (!storage || !key) return
  try {
    storage.removeItem(BUFFER_PREFIX + key)
    const index = readBufferIndex(storage).filter((entry) => entry.key !== key)
    writeBufferIndex(storage, index)
  } catch {
    // Ignore — best-effort cleanup.
  }
}

/**
 * Clear + tombstone the buffer. Call from the close-tab path so the
 * subsequent unmount cleanup (which serializes and writes) can't resurrect
 * what the user explicitly threw away. The tombstone lasts for the page
 * session — sufficient because tab IDs are unique per session.
 */
export function closeTerminalBuffer(key: string): void {
  if (!key) return
  tombstonedKeys.add(key)
  clearTerminalBuffer(key)
}

export function clearAllTerminalBuffers(): void {
  const storage = safeStorage()
  if (!storage) return
  try {
    const index = readBufferIndex(storage)
    for (const entry of index) storage.removeItem(BUFFER_PREFIX + entry.key)
    storage.removeItem(BUFFER_INDEX_KEY)
  } catch {
    // Ignore — best-effort cleanup.
  }
}

export const TERMINAL_BUFFER_MAX_BYTES = MAX_BUFFER_BYTES

/**
 * Terminal font-size preference (global, not per-tab).
 *
 * Cmd/Ctrl + = / - / 0 adjust the size live and persist it here so the
 * preference survives reloads and applies to every tab on the next mount.
 */

const FONT_SIZE_KEY = "superserve.terminal-font-size"
const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 12
const MAX_FONT_SIZE = 32

export function loadTerminalFontSize(): number {
  const storage = safeStorage()
  if (!storage) return DEFAULT_FONT_SIZE
  try {
    const raw = storage.getItem(FONT_SIZE_KEY)
    if (!raw) return DEFAULT_FONT_SIZE
    const parsed = Number.parseInt(raw, 10)
    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_FONT_SIZE ||
      parsed > MAX_FONT_SIZE
    )
      return DEFAULT_FONT_SIZE
    return parsed
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

export function saveTerminalFontSize(size: number): void {
  const storage = safeStorage()
  if (!storage) return
  const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size))
  try {
    storage.setItem(FONT_SIZE_KEY, String(clamped))
  } catch {
    // Ignore — preference is best-effort.
  }
}

export const TERMINAL_FONT_SIZE_DEFAULT = DEFAULT_FONT_SIZE
export const TERMINAL_FONT_SIZE_MIN = MIN_FONT_SIZE
export const TERMINAL_FONT_SIZE_MAX = MAX_FONT_SIZE
