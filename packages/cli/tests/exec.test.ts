import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  installFakeWebSocket,
  textFrames,
  type FakeSocket,
} from "./exec-fake-ws"
import { json, runCli, SANDBOX_ID } from "./harness"

const activated = (token: string) =>
  json({
    id: SANDBOX_ID,
    name: "box",
    status: "active",
    access_token: token,
    routing_hint: "hint-1",
  })

const finish = (sock: FakeSocket, code: number) => {
  sock.receive(JSON.stringify({ exit_code: code, finished: true }))
  sock.serverClose(1000, "command exited")
}

let restore = () => {}
afterEach(() => restore())

describe("exec", () => {
  test("speaks the exec protocol, streams bytes exactly, and passes the exit code through", async () => {
    const fake = installFakeWebSocket(["open"], (sock, frame) => {
      if (typeof frame !== "string" || JSON.parse(frame).type !== "stdin_close")
        return
      // A multi-byte rune split across frames, plus bytes that aren't UTF-8.
      sock.receive(new Uint8Array([1, 0xff, 0x00, 0xe2, 0x82]))
      sock.receive(new Uint8Array([1, 0xac]))
      sock.receive(new Uint8Array([2, 0x65]))
      finish(sock, 7)
    })
    restore = fake.restore
    const r = await runCli(
      [
        "exec",
        SANDBOX_ID,
        "-w",
        "/app",
        "-e",
        "A=1",
        "--timeout",
        "2m",
        "--",
        "grep",
        "a b",
        "it's",
      ],
      {
        fetch: (req) =>
          req.url.pathname.endsWith("/activate")
            ? activated("tok-1")
            : undefined,
      },
    )
    expect(r.exitCode).toBe(7)
    expect(r.requests).toHaveLength(1)
    const [sock] = fake.sockets
    expect(sock.url).toBe(
      `wss://boxd-${SANDBOX_ID}.sandbox.superserve.ai/exec/connect`,
    )
    expect(sock.protocols).toEqual([
      "superserve.exec.v1",
      "token.tok-1",
      "route.hint-1",
    ])
    expect(textFrames(sock)).toEqual([
      {
        command: `grep 'a b' 'it'\\''s'`,
        working_dir: "/app",
        env: { A: "1" },
        timeout_s: 120,
      },
      { type: "stdin_close" },
    ])
    expect(sock.stdoutBytes).toEqual([0xff, 0x00, 0xe2, 0x82, 0xac])
    expect(r.stderr).toBe("e")
  })

  test("-i forwards stdin as tagged binary frames, then closes stdin", async () => {
    const input = new Uint8Array(40 * 1024).map((_, i) => i % 256)
    const fake = installFakeWebSocket(["open"], (sock, frame) => {
      if (typeof frame === "string" && JSON.parse(frame).type === "stdin_close")
        finish(sock, 0)
    })
    restore = fake.restore
    const r = await runCli(["exec", "-i", SANDBOX_ID, "cat"], {
      stdin: input,
      fetch: () => activated("tok"),
    })
    expect(r.exitCode).toBe(0)
    const frames = fake.sockets[0].sent.filter(
      (f): f is Uint8Array => typeof f !== "string",
    )
    expect(frames.every((f) => f[0] === 0 && f.length <= 32 * 1024 + 1)).toBe(
      true,
    )
    expect(Buffer.concat(frames.map((f) => f.subarray(1)))).toEqual(
      Buffer.from(input),
    )
    expect(textFrames(fake.sockets[0]).at(-1)).toEqual({ type: "stdin_close" })
  })

  test("a failed dial activates again and retries once with the fresh token", async () => {
    let n = 0
    const fake = installFakeWebSocket(["fail", "open"], (sock, frame) => {
      if (typeof frame === "string" && JSON.parse(frame).type === "stdin_close")
        finish(sock, 0)
    })
    restore = fake.restore
    const r = await runCli(["exec", SANDBOX_ID, "true"], {
      fetch: () => activated(`tok-${++n}`),
    })
    expect(r.exitCode).toBe(0)
    expect(fake.sockets.map((s) => s.protocols[1])).toEqual([
      "token.tok-1",
      "token.tok-2",
    ])
  })

  test("a repeat exec reuses the token; a stale one falls back to activate", async () => {
    const env = {
      SUPERSERVE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "ss-tok-")),
    }
    let n = 0
    const fetch = () => activated(`tok-${++n}`)
    const done = (sock: FakeSocket, frame: string | Uint8Array) => {
      if (typeof frame === "string" && JSON.parse(frame).type === "stdin_close")
        finish(sock, 0)
    }

    let fake = installFakeWebSocket(["open"], done)
    restore = fake.restore
    await runCli(["exec", SANDBOX_ID, "true"], { env, fetch })
    fake.restore()

    fake = installFakeWebSocket(["open"], done)
    restore = fake.restore
    const reused = await runCli(["exec", SANDBOX_ID, "true"], { env, fetch })
    expect(reused.requests).toHaveLength(0)
    expect(fake.sockets[0].protocols[1]).toBe("token.tok-1")
    fake.restore()

    // e.g. the sandbox paused since: the cached dial fails, activate resumes it.
    fake = installFakeWebSocket(["fail", "open"], done)
    restore = fake.restore
    const stale = await runCli(["exec", SANDBOX_ID, "true"], { env, fetch })
    expect(stale.exitCode).toBe(0)
    expect(fake.sockets.map((s) => s.protocols[1])).toEqual([
      "token.tok-1",
      "token.tok-2",
    ])
  })

  test("a connection lost before the finished frame exits 1 and says so", async () => {
    const fake = installFakeWebSocket(["open"], (sock, frame) => {
      if (
        typeof frame === "string" &&
        JSON.parse(frame).type === "stdin_close"
      ) {
        sock.serverClose(1006)
      }
    })
    restore = fake.restore
    const r = await runCli(["exec", SANDBOX_ID, "sleep 100"], {
      fetch: () => activated("t"),
    })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain("may still be running")
  })

  test("Ctrl-C is forwarded as a signal; a second one disconnects with 130", async () => {
    const fake = installFakeWebSocket(["open"], (_sock, frame) => {
      if (
        typeof frame === "string" &&
        JSON.parse(frame).type === "stdin_close"
      ) {
        setTimeout(() => {
          process.emit("SIGINT")
          process.emit("SIGINT")
        }, 0)
      }
    })
    restore = fake.restore
    const r = await runCli(["exec", SANDBOX_ID, "sleep 100"], {
      fetch: () => activated("t"),
    })
    expect(r.exitCode).toBe(130)
    expect(textFrames(fake.sockets[0])).toContainEqual({
      type: "signal",
      name: "SIGINT",
    })
    expect(process.listenerCount("SIGINT")).toBe(0)
  })

  test("--json decodes buffered output and keeps the remote exit code", async () => {
    const fake = installFakeWebSocket(["open"], (sock, frame) => {
      if (typeof frame !== "string" || JSON.parse(frame).type !== "stdin_close")
        return
      sock.receive(new Uint8Array([1, 0xe2, 0x82]))
      sock.receive(new Uint8Array([1, 0xac, 0x0a]))
      finish(sock, 2)
    })
    restore = fake.restore
    const r = await runCli(["exec", SANDBOX_ID, "--json", "--", "echo"], {
      fetch: () => activated("t"),
    })
    expect(r.exitCode).toBe(2)
    expect(JSON.parse(r.stdout)).toEqual({
      exit_code: 2,
      stdout: "€\n",
      stderr: "",
    })
  })

  test("a dash option before -- is rejected with a hint", async () => {
    const r = await runCli(["exec", SANDBOX_ID, "ls", "-la"])
    expect(r.exitCode).toBe(2)
    expect(r.requests).toHaveLength(0)
    expect(r.stderr).toContain("after --")
  })
})
