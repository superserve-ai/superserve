import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  clearTerminalTabsStorage,
  loadTerminalTabs,
  saveTerminalTabs,
  TERMINAL_TABS_MAX_COUNT,
  TERMINAL_TABS_MAX_NAME_LENGTH,
  TERMINAL_TABS_STORAGE_KEY,
} from "./terminal-tabs-storage"

describe("terminal-tabs-storage", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  describe("loadTerminalTabs", () => {
    it("returns null when storage is empty", () => {
      expect(loadTerminalTabs()).toBeNull()
    })

    it("returns saved tabs when valid", () => {
      const tabs = [
        { id: "a", name: "Terminal 1" },
        { id: "b", name: "build" },
      ]
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify(tabs),
      )
      expect(loadTerminalTabs()).toEqual(tabs)
    })

    it("returns null and clears storage when JSON is malformed", () => {
      window.localStorage.setItem(TERMINAL_TABS_STORAGE_KEY, "not-json{")
      expect(loadTerminalTabs()).toBeNull()
      expect(window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY)).toBeNull()
    })

    it("returns null and clears storage when payload is not an array", () => {
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify({ id: "a", name: "Terminal 1" }),
      )
      expect(loadTerminalTabs()).toBeNull()
      expect(window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY)).toBeNull()
    })

    it("filters out invalid tab entries", () => {
      const tabs = [
        { id: "a", name: "Terminal 1" },
        { id: "", name: "empty id" },
        { id: "c", name: "" },
        { id: "d" },
        null,
        "string",
        { id: "e", name: "valid" },
      ]
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify(tabs),
      )
      expect(loadTerminalTabs()).toEqual([
        { id: "a", name: "Terminal 1" },
        { id: "e", name: "valid" },
      ])
    })

    it("returns null when all entries are invalid", () => {
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify([null, { id: "" }]),
      )
      expect(loadTerminalTabs()).toBeNull()
    })

    it("caps the loaded list at MAX_COUNT", () => {
      const tabs = Array.from(
        { length: TERMINAL_TABS_MAX_COUNT + 5 },
        (_, i) => ({
          id: `t-${i}`,
          name: `Terminal ${i + 1}`,
        }),
      )
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify(tabs),
      )
      expect(loadTerminalTabs()).toHaveLength(TERMINAL_TABS_MAX_COUNT)
    })

    it("rejects names longer than MAX_NAME_LENGTH", () => {
      const tooLong = "x".repeat(TERMINAL_TABS_MAX_NAME_LENGTH + 1)
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify([
          { id: "a", name: tooLong },
          { id: "b", name: "ok" },
        ]),
      )
      expect(loadTerminalTabs()).toEqual([{ id: "b", name: "ok" }])
    })
  })

  describe("saveTerminalTabs", () => {
    it("writes the array as JSON", () => {
      const tabs = [{ id: "a", name: "Terminal 1" }]
      saveTerminalTabs(tabs)
      expect(
        JSON.parse(
          window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY) ?? "[]",
        ),
      ).toEqual(tabs)
    })

    it("trims names that exceed MAX_NAME_LENGTH", () => {
      const tooLong = "x".repeat(TERMINAL_TABS_MAX_NAME_LENGTH + 20)
      saveTerminalTabs([{ id: "a", name: tooLong }])
      const stored = JSON.parse(
        window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY) ?? "[]",
      ) as Array<{ id: string; name: string }>
      expect(stored[0].name).toHaveLength(TERMINAL_TABS_MAX_NAME_LENGTH)
    })

    it("caps the saved list at MAX_COUNT", () => {
      const tabs = Array.from(
        { length: TERMINAL_TABS_MAX_COUNT + 3 },
        (_, i) => ({
          id: `t-${i}`,
          name: `Terminal ${i + 1}`,
        }),
      )
      saveTerminalTabs(tabs)
      const stored = JSON.parse(
        window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY) ?? "[]",
      ) as unknown[]
      expect(stored).toHaveLength(TERMINAL_TABS_MAX_COUNT)
    })
  })

  describe("clearTerminalTabsStorage", () => {
    it("removes the stored value", () => {
      saveTerminalTabs([{ id: "a", name: "Terminal 1" }])
      clearTerminalTabsStorage()
      expect(window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY)).toBeNull()
    })

    it("is a no-op when nothing is stored", () => {
      expect(() => clearTerminalTabsStorage()).not.toThrow()
      expect(window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY)).toBeNull()
    })
  })
})
