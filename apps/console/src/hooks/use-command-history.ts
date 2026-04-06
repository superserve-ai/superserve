// src/hooks/use-command-history.ts
import { useCallback, useRef, useState } from "react"

const STORAGE_PREFIX = "superserve-cmd-history-"
const MAX_HISTORY = 50

function loadHistory(sandboxId: string): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${sandboxId}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(sandboxId: string, history: string[]) {
  localStorage.setItem(
    `${STORAGE_PREFIX}${sandboxId}`,
    JSON.stringify(history.slice(0, MAX_HISTORY)),
  )
}

export function useCommandHistory(sandboxId: string) {
  const [history, setHistory] = useState<string[]>(() =>
    loadHistory(sandboxId),
  )
  const indexRef = useRef(-1)
  const draftRef = useRef("")

  const push = useCallback(
    (command: string) => {
      const trimmed = command.trim()
      if (!trimmed) return
      const next = [trimmed, ...history.filter((h) => h !== trimmed)].slice(
        0,
        MAX_HISTORY,
      )
      setHistory(next)
      saveHistory(sandboxId, next)
      indexRef.current = -1
      draftRef.current = ""
    },
    [sandboxId, history],
  )

  const navigate = useCallback(
    (direction: "up" | "down", currentInput: string): string | null => {
      if (history.length === 0) return null

      if (indexRef.current === -1) {
        draftRef.current = currentInput
      }

      if (direction === "up") {
        const next = Math.min(indexRef.current + 1, history.length - 1)
        indexRef.current = next
        return history[next]
      }

      const next = indexRef.current - 1
      if (next < 0) {
        indexRef.current = -1
        return draftRef.current
      }
      indexRef.current = next
      return history[next]
    },
    [history],
  )

  const reset = useCallback(() => {
    indexRef.current = -1
    draftRef.current = ""
  }, [])

  return { history, push, navigate, reset }
}
