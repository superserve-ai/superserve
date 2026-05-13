/**
 * terminal-tabs — container, tab strip, tab panels, rename UX.
 *
 * Mocks wterm/WebSocket so the SandboxTerminal children render without real
 * resources. Mocks `motion/react` to plain spans (the layoutId animation logic
 * isn't relevant to behavior tests).
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TERMINAL_TABS_STORAGE_KEY } from "@/lib/terminal-tabs-storage"

// --- wterm mocks (same shape as terminal.test.tsx) ---
const wtermInstances: Array<{
  cols: number
  rows: number
  options: {
    onData?: (data: string) => void
    onResize?: (cols: number, rows: number) => void
  }
  init: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}> = []

vi.mock("@wterm/dom", () => {
  class WTerm {
    cols = 80
    rows = 24
    options: (typeof wtermInstances)[number]["options"]
    init = vi.fn().mockResolvedValue(undefined)
    write = vi.fn()
    focus = vi.fn()
    destroy = vi.fn()
    constructor(
      _element: HTMLElement,
      options: (typeof wtermInstances)[number]["options"],
    ) {
      this.options = options
      wtermInstances.push(this)
    }
  }
  return { WTerm }
})

vi.mock("@wterm/ghostty", () => ({
  GhosttyCore: { load: vi.fn().mockResolvedValue({}) },
}))

vi.mock("@wterm/dom/css", () => ({}))

// --- posthog ---
const mockCapture = vi.fn()
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

// --- motion: render plain spans so layoutId logic is inert in tests ---
// (TerminalTabs only uses motion.span; rendering a span for every accessed key
// is enough for behavior tests and keeps the mock simple.)
vi.mock("motion/react", () => ({
  motion: new Proxy(
    {},
    {
      get: () =>
        function MockMotion(props: Record<string, unknown>) {
          const {
            layoutId: _layoutId,
            transition: _transition,
            ...rest
          } = props
          return <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)} />
        },
    },
  ),
}))

// --- Base-UI Tooltip rendering portals can interfere; render plain children ---
vi.mock("@base-ui/react/tooltip", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    Tooltip: {
      Provider: Pass,
      Root: Pass,
      Trigger: ({
        render,
        ...rest
      }: {
        render?: React.ReactElement
        children?: React.ReactNode
      }) => {
        if (render) return render
        return <>{(rest as { children?: React.ReactNode }).children}</>
      },
      Portal: Pass,
      Positioner: Pass,
      Popup: Pass,
    },
  }
})

// --- Controllable fake WebSocket ---
class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string
  protocols?: string | string[]
  readyState = 0
  binaryType = ""
  onopen: (() => void) | null = null
  onmessage: ((evt: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((evt: { code: number }) => void) | null = null
  send = vi.fn()
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000 })
  })

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }

  triggerOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
}

vi.stubGlobal("WebSocket", FakeWebSocket)

import { TerminalTabs } from "./terminal-tabs"

describe("TerminalTabs", () => {
  beforeEach(() => {
    window.localStorage.clear()
    FakeWebSocket.instances = []
    wtermInstances.length = 0
    mockCapture.mockReset()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  describe("rendering", () => {
    it("renders a single default tab when storage is empty", () => {
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)
      const tabList = screen.getByRole("tablist", { name: /terminal tabs/i })
      const tabs = within(tabList).getAllByRole("tab")
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toHaveTextContent("Terminal 1")
      expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    })

    it("restores tabs from localStorage", () => {
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify([
          { id: "a", name: "build" },
          { id: "b", name: "dev" },
        ]),
      )
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)
      const tabs = screen.getAllByRole("tab")
      expect(tabs).toHaveLength(2)
      expect(tabs[0]).toHaveTextContent("build")
      expect(tabs[1]).toHaveTextContent("dev")
      expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    })

    it("opens a WebSocket per tab", async () => {
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify([
          { id: "a", name: "Terminal 1" },
          { id: "b", name: "Terminal 2" },
        ]),
      )
      render(<TerminalTabs sandboxId="sbx-1" accessToken="tok" />)
      // Each SandboxTerminal goes through an async WASM-load + init chain
      // before it opens its WebSocket.
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    })

    it("only the active tab panel is visible", () => {
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify([
          { id: "a", name: "Terminal 1" },
          { id: "b", name: "Terminal 2" },
        ]),
      )
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)
      const panels = document.querySelectorAll('[role="tabpanel"]')
      expect(panels).toHaveLength(2)
      expect((panels[0] as HTMLElement).style.display).toBe("block")
      expect((panels[1] as HTMLElement).style.display).toBe("none")
    })
  })

  describe("adding tabs", () => {
    it("clicking + adds a new tab and selects it", async () => {
      const user = userEvent.setup()
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)

      const addBtn = screen.getByRole("button", { name: /new terminal tab/i })
      await user.click(addBtn)

      const tabs = screen.getAllByRole("tab")
      expect(tabs).toHaveLength(2)
      expect(tabs[1]).toHaveTextContent("Terminal 2")
      expect(tabs[1]).toHaveAttribute("aria-selected", "true")

      expect(mockCapture).toHaveBeenCalledWith(
        "terminal_tab_opened",
        expect.objectContaining({ sandbox_id: "sbx-1" }),
      )
    })

    it("disables + button at the cap", async () => {
      const user = userEvent.setup()
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)

      const addBtn = screen.getByRole("button", { name: /new terminal tab/i })
      // We have 1 tab — click 9 more times to hit 10
      for (let i = 0; i < 9; i++) await user.click(addBtn)

      expect(screen.getAllByRole("tab")).toHaveLength(10)
      expect(addBtn).toBeDisabled()
    })
  })

  describe("switching tabs", () => {
    it("clicking an inactive tab makes it active", async () => {
      const user = userEvent.setup()
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify([
          { id: "a", name: "Terminal 1" },
          { id: "b", name: "Terminal 2" },
        ]),
      )
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)

      const [first, second] = screen.getAllByRole("tab")
      expect(first).toHaveAttribute("aria-selected", "true")

      await user.click(second)
      expect(second).toHaveAttribute("aria-selected", "true")
      expect(first).toHaveAttribute("aria-selected", "false")

      // The active panel switches
      const panels = document.querySelectorAll('[role="tabpanel"]')
      expect((panels[0] as HTMLElement).style.display).toBe("none")
      expect((panels[1] as HTMLElement).style.display).toBe("block")
    })
  })

  describe("closing tabs", () => {
    it("clicking close removes the tab and emits a posthog event", async () => {
      const user = userEvent.setup()
      window.localStorage.setItem(
        TERMINAL_TABS_STORAGE_KEY,
        JSON.stringify([
          { id: "a", name: "Terminal 1" },
          { id: "b", name: "Terminal 2" },
        ]),
      )
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)

      const closeBtn = screen.getByRole("button", { name: /close terminal 2/i })
      await user.click(closeBtn)

      const tabs = screen.getAllByRole("tab")
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toHaveTextContent("Terminal 1")
      expect(mockCapture).toHaveBeenCalledWith(
        "terminal_tab_closed",
        expect.objectContaining({ sandbox_id: "sbx-1" }),
      )
    })

    it("closing the only tab creates a fresh Terminal 1", async () => {
      const user = userEvent.setup()
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)
      const closeBtn = screen.getByRole("button", { name: /close terminal 1/i })
      await user.click(closeBtn)

      const tabs = screen.getAllByRole("tab")
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toHaveTextContent("Terminal 1")
    })
  })

  describe("renaming tabs", () => {
    it("double-click name and Enter saves the new name", async () => {
      const user = userEvent.setup()
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)

      const tab = screen.getByRole("tab")
      await user.dblClick(tab)

      const input = screen.getByRole("textbox", { name: /rename tab/i })
      await user.clear(input)
      await user.type(input, "build")
      await user.keyboard("{Enter}")

      expect(screen.getByRole("tab")).toHaveTextContent("build")
      expect(mockCapture).toHaveBeenCalledWith(
        "terminal_tab_renamed",
        expect.objectContaining({ sandbox_id: "sbx-1" }),
      )
    })

    it("Escape cancels the rename", async () => {
      const user = userEvent.setup()
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)

      const tab = screen.getByRole("tab")
      await user.dblClick(tab)

      const input = screen.getByRole("textbox", { name: /rename tab/i })
      await user.clear(input)
      await user.type(input, "ignored")
      await user.keyboard("{Escape}")

      expect(screen.getByRole("tab")).toHaveTextContent("Terminal 1")
    })

    it("blur with the same value cancels the rename without firing posthog", async () => {
      const user = userEvent.setup()
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)

      const tab = screen.getByRole("tab")
      await user.dblClick(tab)

      const input = screen.getByRole("textbox", { name: /rename tab/i })
      fireEvent.blur(input)

      await waitFor(() => {
        expect(
          screen.queryByRole("textbox", { name: /rename tab/i }),
        ).not.toBeInTheDocument()
      })
      expect(screen.getByRole("tab")).toHaveTextContent("Terminal 1")
      expect(
        mockCapture.mock.calls.find((c) => c[0] === "terminal_tab_renamed"),
      ).toBeUndefined()
    })

    it("trimmed-empty input cancels the rename", async () => {
      const user = userEvent.setup()
      render(<TerminalTabs sandboxId="sbx-1" accessToken="t" />)

      const tab = screen.getByRole("tab")
      await user.dblClick(tab)

      const input = screen.getByRole("textbox", { name: /rename tab/i })
      await user.clear(input)
      await user.type(input, "   ")
      await user.keyboard("{Enter}")

      expect(screen.getByRole("tab")).toHaveTextContent("Terminal 1")
    })
  })
})
