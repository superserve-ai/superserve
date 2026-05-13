/**
 * terminal — WebSocket lifecycle + reconnect.
 *
 * wterm is heavy (WASM) and not happy-dom-friendly, so we mock it. We also
 * swap the global `WebSocket` for a controllable fake so we can simulate
 * open/close/error and assert what the component sends.
 */

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// --- wterm mocks ---
interface WTermInstance {
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
}

const wtermInstances: WTermInstance[] = []

vi.mock("@wterm/dom", () => {
  class WTerm implements WTermInstance {
    cols = 80
    rows = 24
    options: WTermInstance["options"]
    init = vi.fn().mockResolvedValue(undefined)
    write = vi.fn()
    focus = vi.fn()
    destroy = vi.fn()
    constructor(_element: HTMLElement, options: WTermInstance["options"]) {
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

import { SandboxTerminal } from "./terminal"

// Init goes through GhosttyCore.load() → new WTerm() → term.init() before the
// component opens the WebSocket. Wait for the WS to appear so tests don't race
// the async chain.
async function waitForReady() {
  await waitFor(() => {
    expect(wtermInstances.length).toBeGreaterThan(0)
    expect(FakeWebSocket.instances.length).toBeGreaterThan(0)
  })
}

describe("SandboxTerminal", () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    wtermInstances.length = 0
    mockCapture.mockReset()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it("opens a WebSocket with the correct URL and subprotocols", async () => {
    render(<SandboxTerminal sandboxId="sbx-123" accessToken="tok-xyz" />)
    await waitForReady()
    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain("wss://boxd-sbx-123.")
    expect(ws.url).toContain("/terminal")
    expect(ws.protocols).toEqual(["superserve.terminal.v1", "token.tok-xyz"])
  })

  it("sends a resize message and focuses the terminal on open", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()

    expect(ws.send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(payload).toEqual({ type: "resize", cols: 80, rows: 24 })

    expect(term.focus).toHaveBeenCalled()
    expect(mockCapture).toHaveBeenCalledWith(
      "terminal_session_started",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })

  it("writes incoming binary messages to the terminal", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()

    const bytes = new Uint8Array([104, 105]).buffer // "hi"
    ws.triggerMessage(bytes)

    expect(term.write).toHaveBeenCalled()
    const last = term.write.mock.calls.at(-1)?.[0]
    expect(last).toBeInstanceOf(Uint8Array)
  })

  it("ignores incoming string messages (control messages, not terminal data)", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    term.write.mockClear()

    ws.triggerMessage('{"type":"pong"}')
    expect(term.write).not.toHaveBeenCalled()
  })

  it("labels close code 1000 as session ended", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    ws.triggerClose(1000)

    const writes = term.write.mock.calls.map((c) => c[0]).join("")
    expect(writes).toContain("session ended")
    expect(mockCapture).toHaveBeenCalledWith(
      "terminal_session_ended",
      expect.objectContaining({ close_code: 1000 }),
    )
  })

  it("labels close code 1006 as connection lost", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    ws.triggerClose(1006)

    const writes = term.write.mock.calls.map((c) => c[0]).join("")
    expect(writes).toContain("connection lost")
  })

  it("labels close code 1001 as sandbox going away", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    ws.triggerClose(1001)

    const writes = term.write.mock.calls.map((c) => c[0]).join("")
    expect(writes).toContain("sandbox going away")
  })

  it("shows reconnect button on disconnect and creates a new WebSocket on click", async () => {
    const user = userEvent.setup()
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const firstWs = FakeWebSocket.instances[0]
    firstWs.triggerOpen()
    firstWs.triggerClose(1006)

    const reconnectBtn = await screen.findByRole("button", {
      name: /Reconnect/i,
    })
    await user.click(reconnectBtn)

    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2)
    expect(mockCapture).toHaveBeenCalledWith(
      "terminal_reconnected",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })

  it("closes the WebSocket and destroys the terminal on unmount", async () => {
    const { unmount } = render(
      <SandboxTerminal sandboxId="sbx-1" accessToken="t" />,
    )
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    unmount()
    expect(ws.close).toHaveBeenCalled()
    expect(term.destroy).toHaveBeenCalled()
  })

  it("does not focus the terminal on connect when rendered inactive", async () => {
    render(
      <SandboxTerminal sandboxId="sbx-1" accessToken="t" isActive={false} />,
    )
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    expect(ws.send).toHaveBeenCalledTimes(1)
    expect(term.focus).not.toHaveBeenCalled()
  })

  it("focuses the terminal when transitioning from inactive to active", async () => {
    const { rerender } = render(
      <SandboxTerminal sandboxId="sbx-1" accessToken="t" isActive={false} />,
    )
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    expect(term.focus).not.toHaveBeenCalled()

    rerender(
      <SandboxTerminal sandboxId="sbx-1" accessToken="t" isActive={true} />,
    )
    // The activation effect schedules focus via requestAnimationFrame.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(term.focus).toHaveBeenCalled()
  })

  it("does not send a resize when wterm reports 0×0 dimensions (hidden tab)", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    ws.send.mockClear()

    // wterm's auto-resize observer would call this with degenerate dimensions
    // for a hidden tab — the component must drop these before forwarding.
    term.options.onResize?.(0, 0)
    term.options.onResize?.(1, 1)
    expect(ws.send).not.toHaveBeenCalled()
  })

  it("sends a resize when wterm reports real dimensions", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    ws.send.mockClear()

    term.options.onResize?.(120, 30)

    expect(ws.send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(payload).toEqual({ type: "resize", cols: 120, rows: 30 })
  })

  it("forwards terminal keystrokes to the WebSocket as encoded bytes", async () => {
    render(<SandboxTerminal sandboxId="sbx-1" accessToken="t" />)
    await waitForReady()
    const ws = FakeWebSocket.instances[0]
    const term = wtermInstances[0]
    ws.triggerOpen()
    ws.send.mockClear()

    term.options.onData?.("ls\n")

    expect(ws.send).toHaveBeenCalledTimes(1)
    const sent = ws.send.mock.calls[0][0]
    expect(sent).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(sent as Uint8Array)).toBe("ls\n")
  })
})
