import { afterEach, describe, expect, it, vi } from "vitest"

import { Commands, type CommandsDeps } from "../src/commands.js"
import { SandboxError } from "../src/errors.js"

const CH_STDIN = 0x00
const CH_STDOUT = 0x01
const CH_STDERR = 0x02

// Each new socket runs this on the next microtask. Default: open immediately.
let behavior: (ws: FakeWebSocket) => void = (ws) => ws._open()
const instances: FakeWebSocket[] = []

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  url: string
  protocols: string[]
  binaryType = "blob"
  readyState: number = FakeWebSocket.CONNECTING
  sent: Array<string | Uint8Array> = []

  constructor(url: string, protocols?: string | string[]) {
    super()
    this.url = url
    this.protocols = Array.isArray(protocols)
      ? protocols
      : protocols
        ? [protocols]
        : []
    instances.push(this)
    queueMicrotask(() => behavior(this))
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(new Event("close"))
  }

  // --- test drivers ---
  _open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event("open"))
  }
  _emit(data: string | ArrayBuffer): void {
    this.dispatchEvent(Object.assign(new Event("message"), { data }))
  }
  _closeWith(code: number): void {
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(Object.assign(new Event("close"), { code }))
  }
}

function binFrame(channel: number, ...bytes: number[]): ArrayBuffer {
  return new Uint8Array([channel, ...bytes]).buffer
}

function makeDeps(overrides: Partial<CommandsDeps> = {}): CommandsDeps {
  let token = "tok-initial"
  return {
    sandboxId: "sbx-1",
    sandboxHost: "sandbox.example.com",
    getAccessToken: () => token,
    refreshActivate: async () => {
      token = "tok-refreshed"
      return token
    },
    ...overrides,
  }
}

function last(): FakeWebSocket {
  return instances[instances.length - 1]
}

describe("Commands.spawn", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    instances.length = 0
    behavior = (ws) => ws._open()
  })

  it("dials /exec/connect with the token subprotocol and sends the start frame", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket)
    const commands = new Commands(makeDeps())

    const session = await commands.spawn("echo hi", { cwd: "/app" })
    const ws = last()

    expect(ws.url).toBe("wss://boxd-sbx-1.sandbox.example.com/exec/connect")
    expect(ws.protocols).toEqual(["superserve.exec.v1", "token.tok-initial"])
    expect(ws.binaryType).toBe("arraybuffer")
    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      command: "echo hi",
      working_dir: "/app",
    })

    ws._emit(`{"finished":true,"exit_code":0}`)
    await session.wait()
  })

  it("streams stdout/stderr to callbacks and resolves wait() with the result", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket)
    const commands = new Commands(makeDeps())
    const out: string[] = []
    const err: string[] = []

    const session = await commands.spawn("run", {
      onStdout: (d) => out.push(d),
      onStderr: (d) => err.push(d),
    })
    const ws = last()

    ws._emit(binFrame(CH_STDOUT, 0x68, 0x69, 0x0a)) // "hi\n"
    ws._emit(binFrame(CH_STDERR, 0x6f, 0x6f, 0x70, 0x73)) // "oops"
    ws._emit(`{"finished":true,"exit_code":7}`)

    const result = await session.wait()
    expect(out).toEqual(["hi\n"])
    expect(err).toEqual(["oops"])
    expect(result).toEqual({ stdout: "hi\n", stderr: "oops", exitCode: 7 })
  })

  it("frames stdin on channel 0 and sends control frames for close/kill", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket)
    const commands = new Commands(makeDeps())

    const session = await commands.spawn("cat")
    const ws = last()
    ws.sent.length = 0 // drop the start frame

    session.stdin.write("ab")
    session.stdin.close()
    session.kill("SIGINT")

    expect(ws.sent[0]).toEqual(new Uint8Array([CH_STDIN, 0x61, 0x62]))
    expect(JSON.parse(ws.sent[1] as string)).toEqual({ type: "stdin_close" })
    expect(JSON.parse(ws.sent[2] as string)).toEqual({
      type: "signal",
      name: "SIGINT",
    })
  })

  it("decodes a multi-byte UTF-8 rune split across frames", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket)
    const commands = new Commands(makeDeps())
    const out: string[] = []

    const session = await commands.spawn("emit", {
      onStdout: (d) => out.push(d),
    })
    const ws = last()

    // "é" (U+00E9) is 0xC3 0xA9 — split across two stdout frames.
    ws._emit(binFrame(CH_STDOUT, 0xc3))
    ws._emit(binFrame(CH_STDOUT, 0xa9))
    ws._emit(`{"finished":true,"exit_code":0}`)

    const result = await session.wait()
    expect(out).toEqual(["é"]) // the empty first decode is suppressed
    expect(result.stdout).toBe("é")
  })

  it("rejects wait() if the connection closes before the command finishes", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket)
    const commands = new Commands(makeDeps())

    const session = await commands.spawn("run")
    const ws = last()
    ws._emit(binFrame(CH_STDOUT, 0x68, 0x69))
    ws._closeWith(1006)

    await expect(session.wait()).rejects.toBeInstanceOf(SandboxError)
  })

  it("resumes and retries once when the first dial fails", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket)
    // First socket fails to open; the rest open normally.
    let first = true
    behavior = (ws) => {
      if (first) {
        first = false
        ws._closeWith(1006)
      } else {
        ws._open()
      }
    }

    const refresh = vi.fn(async () => "tok-refreshed")
    const commands = new Commands(makeDeps({ refreshActivate: refresh }))

    const session = await commands.spawn("run")
    expect(refresh).toHaveBeenCalledOnce()
    expect(instances).toHaveLength(2)
    expect(last().protocols).toEqual([
      "superserve.exec.v1",
      "token.tok-refreshed",
    ])

    last()._emit(`{"finished":true,"exit_code":0}`)
    await session.wait()
  })
})
