"use client"

import { useCallback, useEffect, useState } from "react"

// Mirrors the SDK rule (packages/sdk/src/config.ts): the edge proxy only
// reverse-proxies user-app ports in this range. Privileged ports (< 1024) are
// refused, so we reject them up front rather than build a dead URL.
export const MIN_PREVIEW_PORT = 1024
export const MAX_PREVIEW_PORT = 65535
export const MAX_PREVIEW_PORTS = 12

const STORAGE_PREFIX = "superserve.preview-ports."

export interface AddPortResult {
  ok: boolean
  /** Present when ok is false — a human-readable reason for a toast. */
  error?: string
}

export interface UsePreviewPortsApi {
  ports: number[]
  canAddPort: boolean
  addPort: (port: number) => AddPortResult
  removePort: (port: number) => void
}

export function isValidPreviewPort(port: number): boolean {
  return (
    Number.isInteger(port) &&
    port >= MIN_PREVIEW_PORT &&
    port <= MAX_PREVIEW_PORT
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

function loadPorts(sandboxId: string): number[] {
  const storage = safeStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_PREFIX + sandboxId)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<number>()
    const ports: number[] = []
    for (const value of parsed) {
      if (typeof value === "number" && isValidPreviewPort(value)) {
        if (!seen.has(value)) {
          seen.add(value)
          ports.push(value)
        }
      }
    }
    return ports.slice(0, MAX_PREVIEW_PORTS)
  } catch {
    return []
  }
}

function savePorts(sandboxId: string, ports: number[]): void {
  const storage = safeStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_PREFIX + sandboxId, JSON.stringify(ports))
  } catch {
    // Quota exceeded or storage disabled — best-effort; the worst case is the
    // port list doesn't survive a reload.
  }
}

/**
 * Per-sandbox list of preview ports the user has added, persisted in
 * localStorage. Purely client-side — there is no backend tracking of "exposed"
 * ports; every user-app port is already reachable through the proxy.
 */
export function usePreviewPorts(sandboxId: string): UsePreviewPortsApi {
  const [ports, setPorts] = useState<number[]>(() => loadPorts(sandboxId))

  // Reload when the sandbox changes (the detail page can swap sandboxes
  // without remounting this hook).
  useEffect(() => {
    setPorts(loadPorts(sandboxId))
  }, [sandboxId])

  useEffect(() => {
    savePorts(sandboxId, ports)
  }, [sandboxId, ports])

  // Validate synchronously against current `ports` (not inside the setPorts
  // updater): React does not guarantee the updater runs before addPort
  // returns, so the duplicate / max-ports result must be computed here.
  const addPort = useCallback<UsePreviewPortsApi["addPort"]>(
    (port) => {
      if (!isValidPreviewPort(port)) {
        return {
          ok: false,
          error: `Enter a port between ${MIN_PREVIEW_PORT} and ${MAX_PREVIEW_PORT}.`,
        }
      }
      if (ports.includes(port)) {
        return { ok: false, error: `Port ${port} is already added.` }
      }
      if (ports.length >= MAX_PREVIEW_PORTS) {
        return {
          ok: false,
          error: `You can preview at most ${MAX_PREVIEW_PORTS} ports.`,
        }
      }
      setPorts((prev) =>
        prev.includes(port) || prev.length >= MAX_PREVIEW_PORTS
          ? prev
          : [...prev, port],
      )
      return { ok: true }
    },
    [ports],
  )

  const removePort = useCallback<UsePreviewPortsApi["removePort"]>((port) => {
    setPorts((prev) => prev.filter((p) => p !== port))
  }, [])

  return {
    ports,
    canAddPort: ports.length < MAX_PREVIEW_PORTS,
    addPort,
    removePort,
  }
}
