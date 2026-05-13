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
  loadAddon: vi.fn(),
  open: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
  onData: vi.fn(),
  write: vi.fn((data: string | Uint8Array) => {
    termWriteCalls.push(data)
  }),
  unicode: { activeVersion: "6" },
}

vi.mock("@xterm/xterm", () => {
  class Terminal {
    constructor() {
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
vi.mock("@xterm/xterm/css/xterm.css", () => ({}))

// --- posthog ---
const mockCapture = vi.fn()
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
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
  triggerMessage(data: unknown) {
    this.onmessage?.({ data })
  }
  triggerClose(code: number) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code })
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
    termWriteCalls.length = 0
    mockCapture.mockReset()
    mockTerm.write.mockClear()
    mockTerm.focus.mockClear()
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
})
