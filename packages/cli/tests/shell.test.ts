import { afterEach, describe, expect, test } from "bun:test"
import { Readable } from "node:stream"

import { installFakeWebSocket, textFrames } from "./exec-fake-ws"
import { json, runCli, SANDBOX_ID } from "./harness"

const activated = () =>
  json({ id: SANDBOX_ID, name: "box", status: "active", access_token: "tok" })

// The harness pipes a plain Readable as stdin; make it look like a TTY.
function fakeTty() {
  const rawModes: boolean[] = []
  const proto = Readable.prototype as unknown as Record<string, unknown>
  Object.defineProperty(proto, "isTTY", {
    get: () => true,
    set: () => {},
    configurable: true,
  })
  proto.setRawMode = (on: boolean) => rawModes.push(on)
  const out = process.stdout as unknown as Record<string, unknown>
  const saved = { isTTY: out.isTTY, columns: out.columns, rows: out.rows }
  Object.assign(out, { isTTY: true, columns: 120, rows: 40 })
  return {
    rawModes,
    restore: () => {
      delete proto.isTTY
      delete proto.setRawMode
      Object.assign(out, saved)
    },
  }
}

let restore = () => {}
afterEach(() => restore())

describe("shell", () => {
  test("refuses without a terminal, before any network call", async () => {
    const r = await runCli(["shell", SANDBOX_ID])
    expect(r.exitCode).toBe(2)
    expect(r.requests).toHaveLength(0)
    expect(r.stderr).toContain("superserve exec")
  })

  test("sends raw keystrokes after an initial resize and restores the terminal on exit", async () => {
    const tty = fakeTty()
    let close: [number, string] = [1000, "shell exited"]
    const fake = installFakeWebSocket(["open", "open"], (sock, frame) => {
      if (typeof frame !== "string") sock.serverClose(...close)
    })
    restore = () => {
      fake.restore()
      tty.restore()
    }

    const ok = await runCli(["shell", SANDBOX_ID], {
      stdin: "exit\r\u0003",
      fetch: activated,
    })
    expect(ok.exitCode).toBe(0)
    const [sock] = fake.sockets
    expect(sock.url).toBe(
      `wss://boxd-${SANDBOX_ID}.sandbox.superserve.ai/terminal`,
    )
    expect(sock.protocols).toEqual(["superserve.terminal.v1", "token.tok"])
    expect(sock.sent[0]).toBe(
      JSON.stringify({ type: "resize", cols: 120, rows: 40 }),
    )
    // Ctrl-C travels as a byte, untagged.
    expect(Buffer.from(sock.sent[1] as Uint8Array).toString()).toBe(
      "exit\r\u0003",
    )
    expect(tty.rawModes.at(-1)).toBe(false)

    close = [1006, ""]
    const lost = await runCli(["shell", SANDBOX_ID], {
      stdin: "x",
      fetch: activated,
    })
    expect(lost.exitCode).toBe(1)
    expect(textFrames(fake.sockets[1])[0].type).toBe("resize")
    expect(tty.rawModes.at(-1)).toBe(false)
    expect(process.listenerCount("SIGWINCH")).toBe(0)
  })
})
