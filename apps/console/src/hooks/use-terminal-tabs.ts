"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  loadTerminalTabs,
  type PersistedTerminalTab,
  saveTerminalTabs,
  TERMINAL_TABS_MAX_COUNT,
  TERMINAL_TABS_MAX_NAME_LENGTH,
} from "@/lib/terminal-tabs-storage"

export const MAX_TERMINAL_TABS = TERMINAL_TABS_MAX_COUNT
export const MAX_TERMINAL_TAB_NAME_LENGTH = TERMINAL_TABS_MAX_NAME_LENGTH

export type TerminalTab = PersistedTerminalTab

export interface UseTerminalTabsApi {
  tabs: TerminalTab[]
  activeId: string
  canAddTab: boolean
  addTab: () => TerminalTab | null
  closeTab: (id: string) => void
  selectTab: (id: string) => void
  renameTab: (id: string, name: string) => void
  selectNext: () => void
  selectPrev: () => void
  selectByIndex: (index: number) => void
}

function generateId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID()
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function nextDefaultName(existing: TerminalTab[]): string {
  const used = new Set<number>()
  for (const tab of existing) {
    const match = /^Terminal (\d+)$/.exec(tab.name)
    if (match) used.add(Number.parseInt(match[1], 10))
  }
  let n = 1
  while (used.has(n)) n++
  return `Terminal ${n}`
}

function makeDefaultTab(existing: TerminalTab[] = []): TerminalTab {
  return { id: generateId(), name: nextDefaultName(existing) }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return target.isContentEditable
}

// Matches both macOS (⌘+Ctrl) and Linux/Windows (Ctrl+Alt). Shift is allowed
// either way; using it doesn't break the gesture.
function matchesShortcutModifier(e: KeyboardEvent): boolean {
  return (e.metaKey && e.ctrlKey) || (e.ctrlKey && e.altKey)
}

interface UseTerminalTabsOptions {
  /**
   * When false, the hook does not attach any global keyboard listeners. Used
   * by tests and would also allow a future "embed mode" to opt out.
   */
  enableKeyboardShortcuts?: boolean
}

export function useTerminalTabs(
  options: UseTerminalTabsOptions = {},
): UseTerminalTabsApi {
  const { enableKeyboardShortcuts = true } = options

  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const stored = loadTerminalTabs()
    if (stored && stored.length > 0) return stored
    return [makeDefaultTab()]
  })
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? "")

  // Mirror state into a ref so window-level handlers always read current values
  // without needing to re-attach.
  const stateRef = useRef({ tabs, activeId })
  useEffect(() => {
    stateRef.current = { tabs, activeId }
  }, [tabs, activeId])

  useEffect(() => {
    saveTerminalTabs(tabs)
  }, [tabs])

  const addTab = useCallback<UseTerminalTabsApi["addTab"]>(() => {
    // Object wrapper so we can capture the new tab from inside setTabs while
    // still using the `prev` callback (needed to handle rapid sequential calls
    // that would otherwise see stale state through a ref). TypeScript narrows
    // property accesses less aggressively than local variables, so this avoids
    // the "Property 'id' does not exist on type 'never'" pitfall.
    const result: { tab: TerminalTab | null } = { tab: null }
    setTabs((prev) => {
      if (prev.length >= MAX_TERMINAL_TABS) return prev
      result.tab = makeDefaultTab(prev)
      return [...prev, result.tab]
    })
    if (result.tab) setActiveId(result.tab.id)
    return result.tab
  }, [])

  const closeTab = useCallback<UseTerminalTabsApi["closeTab"]>((id) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      const remaining = [...prev.slice(0, idx), ...prev.slice(idx + 1)]
      if (remaining.length === 0) {
        const fresh = makeDefaultTab()
        setActiveId(fresh.id)
        return [fresh]
      }
      setActiveId((current) => {
        if (current !== id) return current
        const nextIdx = Math.min(idx, remaining.length - 1)
        return remaining[nextIdx].id
      })
      return remaining
    })
  }, [])

  const selectTab = useCallback<UseTerminalTabsApi["selectTab"]>((id) => {
    if (!stateRef.current.tabs.some((t) => t.id === id)) return
    setActiveId(id)
  }, [])

  const renameTab = useCallback<UseTerminalTabsApi["renameTab"]>((id, name) => {
    const trimmed = name.trim().slice(0, MAX_TERMINAL_TAB_NAME_LENGTH)
    if (trimmed.length === 0) return
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
    )
  }, [])

  const selectNext = useCallback<UseTerminalTabsApi["selectNext"]>(() => {
    const { tabs: list, activeId: current } = stateRef.current
    if (list.length <= 1) return
    const idx = list.findIndex((t) => t.id === current)
    const nextIdx = (idx + 1) % list.length
    setActiveId(list[nextIdx].id)
  }, [])

  const selectPrev = useCallback<UseTerminalTabsApi["selectPrev"]>(() => {
    const { tabs: list, activeId: current } = stateRef.current
    if (list.length <= 1) return
    const idx = list.findIndex((t) => t.id === current)
    const prevIdx = (idx - 1 + list.length) % list.length
    setActiveId(list[prevIdx].id)
  }, [])

  const selectByIndex = useCallback<UseTerminalTabsApi["selectByIndex"]>(
    (index) => {
      const { tabs: list } = stateRef.current
      if (index < 0 || index >= list.length) return
      setActiveId(list[index].id)
    },
    [],
  )

  useEffect(() => {
    if (!enableKeyboardShortcuts) return
    const handler = (e: KeyboardEvent) => {
      if (!matchesShortcutModifier(e)) return
      if (isEditableTarget(e.target)) return

      const key = e.key.toLowerCase()
      if (key === "t") {
        e.preventDefault()
        addTab()
        return
      }
      if (key === "w") {
        e.preventDefault()
        closeTab(stateRef.current.activeId)
        return
      }
      if (e.key === "ArrowRight") {
        e.preventDefault()
        selectNext()
        return
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        selectPrev()
        return
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        selectByIndex(Number.parseInt(e.key, 10) - 1)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [
    addTab,
    closeTab,
    selectNext,
    selectPrev,
    selectByIndex,
    enableKeyboardShortcuts,
  ])

  return {
    tabs,
    activeId,
    canAddTab: tabs.length < MAX_TERMINAL_TABS,
    addTab,
    closeTab,
    selectTab,
    renameTab,
    selectNext,
    selectPrev,
    selectByIndex,
  }
}
