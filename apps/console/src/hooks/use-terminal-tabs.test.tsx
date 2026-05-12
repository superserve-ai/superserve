import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  TERMINAL_TABS_MAX_COUNT,
  TERMINAL_TABS_STORAGE_KEY,
} from "@/lib/terminal-tabs-storage"

import { MAX_TERMINAL_TABS, useTerminalTabs } from "./use-terminal-tabs"

function fireKey(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {
    meta: true,
    ctrl: true,
  },
  target: EventTarget = window,
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
  })
  target.dispatchEvent(event)
  return event
}

describe("useTerminalTabs", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  describe("initialization", () => {
    it("starts with a single default tab when storage is empty", () => {
      const { result } = renderHook(() => useTerminalTabs())
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].name).toBe("Terminal 1")
      expect(result.current.activeId).toBe(result.current.tabs[0].id)
    })

    it("restores tabs from storage", () => {
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify([
          { id: "a", name: "build" },
          { id: "b", name: "dev" },
        ]),
      )
      const { result } = renderHook(() => useTerminalTabs())
      expect(result.current.tabs).toEqual([
        { id: "a", name: "build" },
        { id: "b", name: "dev" },
      ])
      expect(result.current.activeId).toBe("a")
    })
  })

  describe("addTab", () => {
    it("adds a new tab with the next default name and selects it", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const firstId = result.current.tabs[0].id

      act(() => {
        result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.tabs[1].name).toBe("Terminal 2")
      expect(result.current.activeId).toBe(result.current.tabs[1].id)
      expect(result.current.activeId).not.toBe(firstId)
    })

    it("fills name gaps when intermediate tabs were closed", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
        result.current.addTab()
      })
      // tabs: Terminal 1, Terminal 2, Terminal 3
      const middleId = result.current.tabs[1].id
      act(() => {
        result.current.closeTab(middleId)
      })
      // tabs: Terminal 1, Terminal 3
      act(() => {
        result.current.addTab()
      })
      expect(result.current.tabs.map((t) => t.name)).toEqual([
        "Terminal 1",
        "Terminal 3",
        "Terminal 2",
      ])
    })

    it("is a no-op past the cap", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        for (let i = 0; i < MAX_TERMINAL_TABS + 5; i++) result.current.addTab()
      })
      expect(result.current.tabs).toHaveLength(MAX_TERMINAL_TABS)
      expect(result.current.canAddTab).toBe(false)
    })

    it("returns the new tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const box: { returned: ReturnType<typeof result.current.addTab> } = {
        returned: null,
      }
      act(() => {
        box.returned = result.current.addTab()
      })
      expect(box.returned).not.toBeNull()
      expect(box.returned?.name).toBe("Terminal 2")
    })
  })

  describe("closeTab", () => {
    it("removes the tab and keeps focus when closing a non-active tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
      })
      const firstId = result.current.tabs[0].id
      const secondId = result.current.tabs[1].id
      // first remains active
      act(() => {
        result.current.closeTab(secondId)
      })
      expect(result.current.tabs.map((t) => t.id)).toEqual([firstId])
      expect(result.current.activeId).toBe(firstId)
    })

    it("activates the right neighbor when closing the active tab in the middle", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
        result.current.addTab()
      })
      const [a, b, c] = result.current.tabs.map((t) => t.id)
      act(() => {
        result.current.selectTab(b)
      })
      act(() => {
        result.current.closeTab(b)
      })
      expect(result.current.tabs.map((t) => t.id)).toEqual([a, c])
      expect(result.current.activeId).toBe(c)
    })

    it("activates the left neighbor when closing the rightmost active tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
        result.current.addTab()
      })
      const [a, b, c] = result.current.tabs.map((t) => t.id)
      act(() => {
        result.current.selectTab(c)
      })
      act(() => {
        result.current.closeTab(c)
      })
      expect(result.current.tabs.map((t) => t.id)).toEqual([a, b])
      expect(result.current.activeId).toBe(b)
    })

    it("creates a fresh Terminal 1 when closing the only tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const originalId = result.current.tabs[0].id
      act(() => {
        result.current.closeTab(originalId)
      })
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].name).toBe("Terminal 1")
      expect(result.current.tabs[0].id).not.toBe(originalId)
      expect(result.current.activeId).toBe(result.current.tabs[0].id)
    })

    it("is a no-op for an unknown id", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const before = result.current.tabs.length
      act(() => {
        result.current.closeTab("nope")
      })
      expect(result.current.tabs).toHaveLength(before)
    })
  })

  describe("selectTab", () => {
    it("switches the active tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
      })
      const firstId = result.current.tabs[0].id
      act(() => {
        result.current.selectTab(firstId)
      })
      expect(result.current.activeId).toBe(firstId)
    })

    it("ignores unknown ids", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const before = result.current.activeId
      act(() => {
        result.current.selectTab("does-not-exist")
      })
      expect(result.current.activeId).toBe(before)
    })
  })

  describe("renameTab", () => {
    it("updates the name", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const id = result.current.tabs[0].id
      act(() => {
        result.current.renameTab(id, "build")
      })
      expect(result.current.tabs[0].name).toBe("build")
    })

    it("trims whitespace and rejects empty names", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const id = result.current.tabs[0].id
      const original = result.current.tabs[0].name
      act(() => {
        result.current.renameTab(id, "   ")
      })
      expect(result.current.tabs[0].name).toBe(original)
      act(() => {
        result.current.renameTab(id, "   logs   ")
      })
      expect(result.current.tabs[0].name).toBe("logs")
    })
  })

  describe("selectNext / selectPrev", () => {
    it("wraps around at the end", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
        result.current.addTab()
      })
      const ids = result.current.tabs.map((t) => t.id)
      act(() => {
        result.current.selectTab(ids[2])
      })
      act(() => {
        result.current.selectNext()
      })
      expect(result.current.activeId).toBe(ids[0])
    })

    it("wraps around at the start", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
      })
      const ids = result.current.tabs.map((t) => t.id)
      act(() => {
        result.current.selectTab(ids[0])
      })
      act(() => {
        result.current.selectPrev()
      })
      expect(result.current.activeId).toBe(ids[1])
    })

    it("is a no-op with one tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const before = result.current.activeId
      act(() => {
        result.current.selectNext()
        result.current.selectPrev()
      })
      expect(result.current.activeId).toBe(before)
    })
  })

  describe("selectByIndex", () => {
    it("jumps to the Nth tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
        result.current.addTab()
      })
      const ids = result.current.tabs.map((t) => t.id)
      act(() => {
        result.current.selectByIndex(2)
      })
      expect(result.current.activeId).toBe(ids[2])
    })

    it("ignores out-of-range indices", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const before = result.current.activeId
      act(() => {
        result.current.selectByIndex(99)
      })
      expect(result.current.activeId).toBe(before)
    })
  })

  describe("persistence", () => {
    it("writes to localStorage whenever tabs change", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
      })
      const stored = JSON.parse(
        window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY) ?? "[]",
      ) as Array<{ id: string; name: string }>
      expect(stored).toHaveLength(2)
      expect(stored.map((t) => t.name)).toEqual(["Terminal 1", "Terminal 2"])
    })

    it("does not persist the active id", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
      })
      const raw = window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY) ?? "[]"
      expect(raw).not.toContain("activeId")
    })

    it("storage caps the persisted list at MAX", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        for (let i = 0; i < TERMINAL_TABS_MAX_COUNT + 5; i++)
          result.current.addTab()
      })
      const stored = JSON.parse(
        window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY) ?? "[]",
      ) as unknown[]
      expect(stored).toHaveLength(TERMINAL_TABS_MAX_COUNT)
    })
  })

  describe("keyboard shortcuts", () => {
    it("⌘⌃T adds a new tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        fireKey("t")
      })
      expect(result.current.tabs).toHaveLength(2)
    })

    it("Ctrl+Alt+T also adds a new tab (linux/windows variant)", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        fireKey("t", { ctrl: true, alt: true })
      })
      expect(result.current.tabs).toHaveLength(2)
    })

    it("⌘⌃W closes the active tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
      })
      const activeIdBefore = result.current.activeId
      act(() => {
        fireKey("w")
      })
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.activeId).not.toBe(activeIdBefore)
    })

    it("⌘⌃→ moves to next tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
      })
      const ids = result.current.tabs.map((t) => t.id)
      act(() => {
        result.current.selectTab(ids[0])
      })
      act(() => {
        fireKey("ArrowRight")
      })
      expect(result.current.activeId).toBe(ids[1])
    })

    it("⌘⌃1 jumps to the first tab", () => {
      const { result } = renderHook(() => useTerminalTabs())
      act(() => {
        result.current.addTab()
        result.current.addTab()
      })
      const ids = result.current.tabs.map((t) => t.id)
      act(() => {
        fireKey("1")
      })
      expect(result.current.activeId).toBe(ids[0])
    })

    it("ignores key events without the required modifier", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const before = result.current.tabs.length
      act(() => {
        fireKey("t", {})
      })
      expect(result.current.tabs).toHaveLength(before)
    })

    it("does not fire when the target is an editable element", () => {
      const { result } = renderHook(() => useTerminalTabs())
      const input = document.createElement("input")
      document.body.appendChild(input)
      input.focus()
      const before = result.current.tabs.length
      act(() => {
        fireKey("t", { meta: true, ctrl: true }, input)
      })
      expect(result.current.tabs).toHaveLength(before)
      document.body.removeChild(input)
    })

    it("can be disabled via option", () => {
      const { result } = renderHook(() =>
        useTerminalTabs({ enableKeyboardShortcuts: false }),
      )
      const before = result.current.tabs.length
      act(() => {
        fireKey("t")
      })
      expect(result.current.tabs).toHaveLength(before)
    })
  })
})
