/**
 * terminal — WebSocket lifecycle + reconnect.
 *
 * xterm and its addons are heavy modules that don't play nicely with
 * happy-dom, so we mock them. We also swap the global `WebSocket` for a
 * controllable fake so we can simulate open/close/error and assert what
 * the component sends.
 */

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// --- xterm mocks ---
const termWriteCalls: Array<string | Uint8Array> = []
const mockTerm = {
  cols: 80,
  rows: 24,
  options: {} as Record<string, unknown>,
  loadAddon: vi.fn(),
  open: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
  refresh: vi.fn(),
  onData: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(),
  write: vi.fn((data: string | Uint8Array, cb?: () => void) => {
    termWriteCalls.push(data)
    cb?.()
  }),
  unicode: { activeVersion: "6" },
}

vi.mock("@xterm/xterm", () => {
  class Terminal {
    constructor(options?: Record<string, unknown>) {
      mockTerm.options = { ...options }
      return mockTerm
    }
  }
  return { Terminal }
})
vi.mock("@xterm/addon-fit", () => {
  class FitAddon {
    fit = vi.fn()
    activate = vi.fn()
    dispose = vi.fn()
  }
  return { FitAddon }
})
vi.mock("@xterm/addon-unicode11", () => {
  class Unicode11Addon {
    activate = vi.fn()
    dispose = vi.fn()
  }
  return { Unicode11Addon }
})
vi.mock("@xterm/addon-clipboard", () => {
  class ClipboardAddon {
    activate = vi.fn()
    dispose = vi.fn()
  }
  return { ClipboardAddon }
})
vi.mock("@xterm/addon-image", () => {
  class ImageAddon {
    activate = vi.fn()
    dispose = vi.fn()
  }
  return { ImageAddon }
})
vi.mock("@xterm/addon-search", () => {
  class SearchAddon {
    activate = vi.fn()
    dispose = vi.fn()
    findNext = vi.fn()
    findPrevious = vi.fn()
  }
  return { SearchAddon }
})
vi.mock("@xterm/addon-web-links", () => {
  class WebLinksAddon {
    activate = vi.fn()
    dispose = vi.fn()
  }
  return { WebLinksAddon }
})
vi.mock("@xterm/addon-ligatures", () => {
  class LigaturesAddon {
    activate = vi.fn()
    dispose = vi.fn()
  }
  return { LigaturesAddon }
})
vi.mock("@xterm/addon-serialize", () => {
  class SerializeAddon {
    activate = vi.fn()
    dispose = vi.fn()
    serialize = vi.fn(() => "SERIALIZED_BUFFER")
  }
  return { SerializeAddon }
})
vi.mock("@xterm/addon-webgl", () => {
  class WebglAddon {
    activate = vi.fn()
    dispose = vi.fn()
    onContextLoss = vi.fn()
  }
  return { WebglAddon }
})
vi.mock("@xterm/xterm/css/xterm.css", () => ({}))

// --- posthog ---
const mockCapture = vi.fn()
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

// --- terminal-tabs-storage (so we can assert save/restore) ---
const mockLoadBuffer = vi.fn<(key: string) => string | null>()
const mockSaveBuffer = vi.fn<(key: string, value: string) => void>()
const mockClearBuffer = vi.fn<(key: string) => void>()
const mockLoadFontSize = vi.fn<() => number>()
const mockSaveFontSize = vi.fn<(size: number) => void>()
vi.mock("@/lib/terminal-tabs-storage", () => ({
  loadTerminalBuffer: (key: string) => mockLoadBuffer(key),
  saveTerminalBuffer: (key: string, value: string) =>
    mockSaveBuffer(key, value),
  clearTerminalBuffer: (key: string) => mockClearBuffer(key),
  loadTerminalFontSize: () => mockLoadFontSize(),
  saveTerminalFontSize: (size: number) => mockSaveFontSize(size),
  TERMINAL_FONT_SIZE_DEFAULT: 14,
  TERMINAL_FONT_SIZE_MIN: 12,
  TERMINAL_FONT_SIZE_MAX: 32,
}))

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
  onclose: ((evt: { code: number; reason?: string }) => void) | null = null
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
  triggerMessage(data: unknown) {
    this.onmessage?.({ data })
  }
  triggerClose(code: number, reason?: string) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

vi.stubGlobal("WebSocket", FakeWebSocket)

// --- Controllable ResizeObserver so we can simulate container size changes ---
class MockResizeObserver {
  static callbacks: ResizeObserverCallback[] = []
  callback: ResizeObserverCallback
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.callbacks.push(callback)
  }
}
vi.stubGlobal("ResizeObserver", MockResizeObserver)

import { SandboxTerminal } from "./terminal"

describe("SandboxTerminal", () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    MockResizeObserver.callbacks = []
    mockTerm.cols = 80
    mockTerm.rows = 24
    termWriteCalls.length = 0
    mockCapture.mockReset()
    mockTerm.write.mockClear()
    mockTerm.focus.mockClear()
    mockTerm.refresh.mockClear()
    mockTerm.attachCustomKeyEventHandler.mockClear()
    mockLoadBuffer.mockReset()
    mockLoadBuffer.mockReturnValue(null)
    mockSaveBuffer.mockReset()
    mockClearBuffer.mockReset()
    mockLoadFontSize.mockReset()
    mockLoadFontSize.mockReturnValue(14)
    mockSaveFontSize.mockReset()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it("opens a WebSocket with the correct URL and subprotocols", () => {
    render(<SandboxTerminal sandboxId="sbx-123" accessToken="tok-xyz" />)
    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain("wss://boxd-sbx-123.")
    expect(ws.url).toContain("/terminal")
    expect(ws.protocols).toEqual(["superserve.terminal.v1", "token.tok-xyz"])
  })

  it("configures xterm with dense resolved monospace typography", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)

    expect(mockTerm.options.fontFamily).toContain("Geist Mono")
    expect(mockTerm.options.fontFamily).not.toContain("var(")
    expect(mockTerm.options.fontSize).toBe(14)
    expect(mockTerm.options.lineHeight).toBe(1.12)
    expect(mockTerm.options.letterSpacing).toBe(0)
  })

  it("sends a resize message and focuses the terminal on open", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()

    expect(ws.send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(payload).toEqual({ type: "resize", cols: 80, rows: 24 })

    expect(mockTerm.focus).toHaveBeenCalled()
    expect(mockCapture).toHaveBeenCalledWith(
      "terminal_session_started",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })

  it("does not send an invalid 0×0 resize", () => {
    mockTerm.cols = 0
    mockTerm.rows = 0
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()

    expect(ws.send).not.toHaveBeenCalled()
  })

  it("writes incoming binary messages to the terminal", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()

    const bytes = new Uint8Array([104, 105]).buffer // "hi"
    ws.triggerMessage(bytes)

    expect(mockTerm.write).toHaveBeenCalled()
    const last = mockTerm.write.mock.calls.at(-1)?.[0]
    expect(last).toBeInstanceOf(Uint8Array)
  })

  it("ignores incoming string messages (control messages, not terminal data)", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    mockTerm.write.mockClear()

    ws.triggerMessage('{"type":"pong"}')
    expect(mockTerm.write).not.toHaveBeenCalled()
  })

  it("labels close code 1000 as session ended", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    ws.triggerClose(1000)

    const writes = mockTerm.write.mock.calls.map((c) => c[0]).join("")
    expect(writes).toContain("session ended")
    expect(mockCapture).toHaveBeenCalledWith(
      "terminal_session_ended",
      expect.objectContaining({ close_code: 1000 }),
    )
  })

  it("labels close code 1006 as connection lost", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    ws.triggerClose(1006)

    const writes = mockTerm.write.mock.calls.map((c) => c[0]).join("")
    expect(writes).toContain("connection lost")
  })

  it("surfaces close code 1011 as a server error with the close reason", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    ws.triggerClose(1011, "pty resize failed")

    const writes = mockTerm.write.mock.calls.map((c) => c[0]).join("")
    expect(writes).toContain("server error: pty resize failed")
  })

  it("labels close code 1001 as sandbox going away", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    ws.triggerClose(1001)

    const writes = mockTerm.write.mock.calls.map((c) => c[0]).join("")
    expect(writes).toContain("sandbox going away")
  })

  it("shows reconnect button on disconnect and creates a new WebSocket on click", async () => {
    const user = userEvent.setup()
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    const firstWs = FakeWebSocket.instances[0]
    firstWs.triggerOpen()
    firstWs.triggerClose(1006)

    // Reconnect button should be visible
    const reconnectBtn = await screen.findByRole("button", {
      name: /Reconnect/i,
    })
    await user.click(reconnectBtn)

    // A second WebSocket was opened
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2)
    expect(mockCapture).toHaveBeenCalledWith(
      "terminal_reconnected",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })

  it("closes the WebSocket on unmount", () => {
    const { unmount } = render(
      <SandboxTerminal sandboxId="sbx-1" accessToken="t" />,
    )
    const ws = FakeWebSocket.instances[0]
    unmount()
    expect(ws.close).toHaveBeenCalled()
    expect(mockTerm.dispose).toHaveBeenCalled()
  })

  it("does not focus xterm on connect when rendered inactive", () => {
    render(
      <SandboxTerminal sandboxId="sbx-1" accessToken="t" isActive={false} />,
    )
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    // The resize message still fires, but focus stays where it is.
    expect(ws.send).toHaveBeenCalledTimes(1)
    expect(mockTerm.focus).not.toHaveBeenCalled()
  })

  it("focuses xterm when transitioning from inactive to active", async () => {
    const { rerender } = render(
      <SandboxTerminal sandboxId="sbx-1" accessToken="t" isActive={false} />,
    )
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    expect(mockTerm.focus).not.toHaveBeenCalled()

    rerender(
      <SandboxTerminal sandboxId="sbx-1" accessToken="t" isActive={true} />,
    )
    // The activation effect schedules focus via requestAnimationFrame.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(mockTerm.focus).toHaveBeenCalled()
  })

  it("does not send a resize when the container becomes 0×0 (hidden tab)", () => {
    vi.useFakeTimers()
    try {
      render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
      const ws = FakeWebSocket.instances[0]
      ws.triggerOpen()
      ws.send.mockClear()

      // Simulate the container being hidden: ResizeObserver fires 0×0.
      const callback = MockResizeObserver.callbacks.at(-1)
      callback?.(
        [{ contentRect: { width: 0, height: 0 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )
      vi.advanceTimersByTime(200)

      expect(ws.send).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("sends a resize when the container reports real dimensions", () => {
    vi.useFakeTimers()
    try {
      render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
      const ws = FakeWebSocket.instances[0]
      ws.triggerOpen()
      ws.send.mockClear()

      const callback = MockResizeObserver.callbacks.at(-1)
      callback?.(
        [{ contentRect: { width: 600, height: 400 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )
      vi.advanceTimersByTime(200)

      expect(ws.send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(ws.send.mock.calls[0][0] as string)
      expect(payload).toMatchObject({ type: "resize" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("restores saved buffer before opening the WebSocket when bufferKey is set", () => {
    mockLoadBuffer.mockReturnValue("RESTORED_OUTPUT")
    render(
      <SandboxTerminal
        sandboxId="sbx-1"
        accessToken="t"
        bufferKey="sbx-1:tab-a"
      />,
    )

    expect(mockLoadBuffer).toHaveBeenCalledWith("sbx-1:tab-a")
    // The restore write goes through write() with a callback that triggers
    // the WS connect — so by the time we get here, both have happened.
    expect(mockTerm.write).toHaveBeenCalledWith(
      "RESTORED_OUTPUT",
      expect.any(Function),
    )
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("does not call loadTerminalBuffer when bufferKey is not provided", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    expect(mockLoadBuffer).not.toHaveBeenCalled()
  })

  it("serializes the buffer on unmount when bufferKey is set", () => {
    const { unmount } = render(
      <SandboxTerminal
        sandboxId="sbx-1"
        accessToken="t"
        bufferKey="sbx-1:tab-a"
      />,
    )
    unmount()
    expect(mockSaveBuffer).toHaveBeenCalledWith(
      "sbx-1:tab-a",
      "SERIALIZED_BUFFER",
    )
  })

  it("schedules an auto-reconnect on an abnormal close", () => {
    vi.useFakeTimers()
    try {
      render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
      const first = FakeWebSocket.instances[0]
      first.triggerOpen()
      first.triggerClose(1006)

      expect(FakeWebSocket.instances).toHaveLength(1)
      // First retry is at 500ms (RECONNECT_BASE_MS * 2^0).
      vi.advanceTimersByTime(600)
      expect(FakeWebSocket.instances).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not auto-reconnect on a clean (1000) close", () => {
    vi.useFakeTimers()
    try {
      render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
      const first = FakeWebSocket.instances[0]
      first.triggerOpen()
      first.triggerClose(1000)

      vi.advanceTimersByTime(15_000)
      expect(FakeWebSocket.instances).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("attaches a custom key handler for Cmd+F search", () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    expect(mockTerm.attachCustomKeyEventHandler).toHaveBeenCalledWith(
      expect.any(Function),
    )
  })
})
