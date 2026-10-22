import type { Command } from "commander"

import { activate, type ActivatedSandbox, resolveSandboxId } from "../api"
import { collect, parseDuration, parseKeyValues } from "../args"
import { connection, USER_AGENT } from "../config"
import { CliError, EXIT, usageError } from "../errors"
import { commanderError, isJson, printJson, warn } from "../output"
import { cachedToken, forgetToken, rememberToken } from "../tokens"

// Data-plane wire protocol: see the server's exec_ws.go and terminal.go.
const CH_STDIN = 0
const CH_STDOUT = 1
const CH_STDERR = 2
// Stays under the smallest per-frame limit any deployed server enforces.
const CHUNK_BYTES = 32 * 1024
const SEND_HIGH_WATER = 1024 * 1024
const JSON_OUTPUT_CAP = 10 * 1024 * 1024
const TERMINAL_IDLE_MS = 10 * 60_000
const TERMINAL_MAX_MS = 4 * 3600_000

interface ExecOptions {
  cwd?: string
  env?: string[]
  timeout?: string
  interactive?: boolean
}

export function register(program: Command): void {
  program
    .command("exec")
    .description("Run a command in a sandbox")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<command...>", "Command to run (put it after --)")
    .option("-w, --cwd <dir>", "Working directory in the sandbox")
    .option("-e, --env <KEY=VAL>", "Environment variable (repeatable)", collect)
    .option(
      "--timeout <duration>",
      "Kill the command after this long (e.g. 30s, 10m)",
    )
    .option("-i, --interactive", "Forward local stdin to the command")
    .configureOutput({
      outputError: (str, write) =>
        write(
          commanderError(
            /unknown option/.test(str)
              ? `${str}Put the remote command after --: superserve exec <sandbox> -- <command> [args...]\n`
              : str,
          ),
        ),
    })
    .addHelpText(
      "after",
      `
One argument runs as a shell command string; several are quoted and joined:
  superserve exec my-box "ls -la | wc -l"
  superserve exec my-box -- npm test
  superserve exec my-box -- grep -r "a b" /app

Output is byte-exact, and the exit code is the command's own:
  superserve exec my-box -- cat /tmp/image.png > image.png
  tar cz src | superserve exec -i my-box -- tar xz -C /app

Ctrl-C sends SIGINT to the command; press it again to disconnect.
--json buffers output (10 MiB max) into {"exit_code","stdout","stderr"} as
UTF-8 text; leave it off for binary output.`,
    )
    .action(async (sandbox: string, argv: string[], opts: ExecOptions) => {
      const start: Record<string, unknown> = { command: commandString(argv) }
      if (opts.cwd) start.working_dir = opts.cwd
      const env = parseKeyValues(opts.env, "--env")
      if (env) start.env = env
      if (opts.timeout !== undefined) {
        const s = parseDuration(opts.timeout, "--timeout")
        if (s <= 0) throw usageError("--timeout must be positive.")
        start.timeout_s = s
      }
      const ws = await connect(sandbox, "/exec/connect", "superserve.exec.v1")
      process.exitCode = await runExec(ws, start, Boolean(opts.interactive))
    })

  program
    .command("shell")
    .description("Open an interactive shell in a sandbox")
    .argument("<sandbox>", "Sandbox ID or name")
    .addHelpText(
      "after",
      `
Starts /bin/bash in a terminal. Type exit or press Ctrl-D to leave; Ctrl-C
goes to the remote shell.
  superserve shell my-box

Sessions close after 10 minutes without input or output, and after 4 hours.
For scripts, use: superserve exec <sandbox> -- <command>`,
    )
    .action(async (sandbox: string) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw usageError(
          "superserve shell needs an interactive terminal.",
          "For scripts and pipes, use: superserve exec <sandbox> -- <command>",
        )
      }
      const ws = await connect(sandbox, "/terminal", "superserve.terminal.v1")
      process.exitCode = await runShell(ws)
    })
}

/** One argument is a shell string as-is; several are quoted so each stays one word. */
function commandString(argv: string[]): string {
  if (argv.length === 1) return argv[0]
  return argv
    .map((a) =>
      /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ")
}

// A failed dial is usually a stale token or a paused sandbox: activate (which
// resumes it) and retry. Safe because nothing has been sent yet.
async function connect(
  ref: string,
  path: string,
  protocol: string,
): Promise<WebSocket> {
  const id = await resolveSandboxId(ref)
  const url = `wss://boxd-${id}.${connection().sandboxHost}${path}`
  const isDialError = (err: unknown) =>
    err instanceof CliError && err.code === "connect_failed"
  const cached = cachedToken(id)
  if (cached) {
    try {
      return await dial(url, protocol, cached)
    } catch (err) {
      if (!isDialError(err)) throw err
      forgetToken(id)
    }
  }
  const fresh = async () => {
    const a = await activate(id)
    rememberToken(id, a)
    return a
  }
  try {
    return await dial(url, protocol, await fresh())
  } catch (err) {
    if (!isDialError(err)) throw err
    return await dial(url, protocol, await fresh())
  }
}

function dial(
  url: string,
  protocol: string,
  a: Pick<ActivatedSandbox, "access_token" | "routing_hint">,
): Promise<WebSocket> {
  const protocols = [protocol, `token.${a.access_token}`]
  if (a.routing_hint) protocols.push(`route.${a.routing_hint}`)
  return new Promise((resolve, reject) => {
    // Bun and Node (undici) both take an init object; it's the only way to set headers.
    const ws = new WebSocket(url, {
      protocols,
      headers: { "User-Agent": USER_AGENT },
    } as unknown as string[])
    ws.binaryType = "arraybuffer"
    const settle = () => {
      ws.onopen = ws.onerror = ws.onclose = null
    }
    const fail = (detail: string) => {
      settle()
      reject(
        new CliError(
          `Could not connect to the sandbox (${detail}).`,
          EXIT.ERROR,
          "Check that the sandbox exists and is not failed: superserve sandbox list",
          "connect_failed",
        ),
      )
    }
    ws.onopen = () => {
      settle()
      resolve(ws)
    }
    ws.onerror = () => fail("connection failed")
    ws.onclose = (ev) => fail(`closed with code ${ev.code}`)
  })
}

function sendControl(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function sendBytes(ws: WebSocket, data: Uint8Array, tag?: number): void {
  for (let off = 0; off < data.length; off += CHUNK_BYTES) {
    const chunk = data.subarray(off, off + CHUNK_BYTES)
    if (tag === undefined) {
      ws.send(chunk as Uint8Array<ArrayBuffer>)
      continue
    }
    const frame = new Uint8Array(chunk.length + 1)
    frame[0] = tag
    frame.set(chunk, 1)
    ws.send(frame)
  }
}

/** Forward local stdin until EOF, pausing while the socket's send buffer is full. */
function pumpStdin(
  ws: WebSocket,
  tag: number | undefined,
  onEnd: () => void,
): () => void {
  const stdin = process.stdin
  let timer: ReturnType<typeof setTimeout> | undefined
  const waitDrain = () => {
    if (ws.readyState !== WebSocket.OPEN) return
    if (ws.bufferedAmount > SEND_HIGH_WATER / 2) {
      timer = setTimeout(waitDrain, 10)
    } else stdin.resume()
  }
  const onData = (chunk: Buffer) => {
    if (ws.readyState !== WebSocket.OPEN) return
    sendBytes(ws, chunk, tag)
    if (ws.bufferedAmount > SEND_HIGH_WATER) {
      stdin.pause()
      waitDrain()
    }
  }
  stdin.on("data", onData)
  stdin.once("end", onEnd)
  stdin.resume()
  return () => {
    clearTimeout(timer)
    stdin.off("data", onData)
    stdin.off("end", onEnd)
    stdin.pause()
  }
}

// The WHATWG WebSocket can't pause reads, so a slow stdout buffers
// in memory; we only wait for it to flush before exiting.
function drained(stream: NodeJS.WriteStream): Promise<void> {
  if (!stream.writableNeedDrain) return Promise.resolve()
  return new Promise((resolve) => {
    stream.once("drain", resolve)
    stream.once("error", resolve)
  })
}

async function runExec(
  ws: WebSocket,
  start: Record<string, unknown>,
  interactive: boolean,
): Promise<number> {
  const json = isJson()
  const out: Uint8Array[][] = [[], [], []]
  let buffered = 0
  const cleanups: (() => void)[] = []

  try {
    const code = await new Promise<number>((resolve, reject) => {
      let done = false
      const finish = (code: number | CliError) => {
        if (done) return
        done = true
        ws.close()
        if (code instanceof CliError) reject(code)
        else resolve(code)
      }

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          let msg: { exit_code?: number; finished?: boolean; error?: string }
          try {
            msg = JSON.parse(ev.data)
          } catch {
            return
          }
          if (!msg.finished) return
          finish(
            msg.exit_code ??
              new CliError(
                msg.error || "The command failed to run.",
                EXIT.ERROR,
                undefined,
                "exec_failed",
              ),
          )
          return
        }
        const frame = new Uint8Array(ev.data as ArrayBuffer)
        const ch = frame[0]
        if (ch !== CH_STDOUT && ch !== CH_STDERR) return
        const payload = frame.subarray(1)
        if (!json) {
          ;(ch === CH_STDOUT ? process.stdout : process.stderr).write(payload)
          return
        }
        buffered += payload.length
        if (buffered > JSON_OUTPUT_CAP) {
          sendControl(ws, { type: "signal", name: "SIGKILL" })
          finish(
            new CliError(
              "Output exceeded 10 MiB with --json; the command was killed.",
              EXIT.ERROR,
              "Run without --json to stream output of any size.",
              "output_too_large",
            ),
          )
          return
        }
        out[ch].push(payload)
      }
      ws.onclose = (ev) =>
        finish(
          new CliError(
            `Connection lost before the command finished (${ev.reason || `close code ${ev.code}`}).`,
            EXIT.ERROR,
            "The command may still be running in the sandbox.",
            "connection_lost",
          ),
        )
      ws.onerror = () => {}

      let interrupts = 0
      for (const name of ["SIGINT", "SIGTERM"] as const) {
        const handler = () => {
          if (++interrupts > 1) {
            warn("Disconnected; the command may still be running.")
            finish(name === "SIGINT" ? EXIT.INTERRUPTED : 143)
            return
          }
          sendControl(ws, { type: "signal", name })
          if (process.stderr.isTTY) {
            warn(
              `Sent ${name} to the command; press Ctrl-C again to disconnect.`,
            )
          }
        }
        process.on(name, handler)
        cleanups.push(() => process.off(name, handler))
      }

      ws.send(JSON.stringify(start))
      const closeStdin = () => sendControl(ws, { type: "stdin_close" })
      if (interactive) cleanups.push(pumpStdin(ws, CH_STDIN, closeStdin))
      else closeStdin()
    })

    if (json) {
      const text = (chunks: Uint8Array[]) =>
        Buffer.concat(chunks).toString("utf8")
      printJson({
        exit_code: code,
        stdout: text(out[CH_STDOUT]),
        stderr: text(out[CH_STDERR]),
      })
    }
    await Promise.all([drained(process.stdout), drained(process.stderr)])
    return code
  } finally {
    for (const fn of cleanups) fn()
    ws.onmessage = ws.onclose = null
  }
}

async function runShell(ws: WebSocket): Promise<number> {
  const stdin = process.stdin
  const stdout = process.stdout
  const opened = Date.now()
  let lastActivity = opened
  const restore = () => {
    if (stdin.isTTY) stdin.setRawMode(false)
  }
  process.once("exit", restore)
  const cleanups: (() => void)[] = [restore, () => process.off("exit", restore)]

  try {
    stdin.setRawMode(true)
    const resize = () => {
      const { columns: cols, rows } = stdout
      if (cols && rows) sendControl(ws, { type: "resize", cols, rows })
    }
    resize()
    process.on("SIGWINCH", resize)
    cleanups.push(() => process.off("SIGWINCH", resize))

    return await new Promise<number>((resolve) => {
      const finish = (code: number) => {
        ws.onclose = null
        ws.close()
        resolve(code)
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") return
        lastActivity = Date.now()
        stdout.write(new Uint8Array(ev.data as ArrayBuffer))
      }
      ws.onerror = () => {}
      ws.onclose = (ev) => {
        restore()
        if (ev.code === 1000 && ev.reason === "shell exited") return finish(0)
        // The server closes both limits with the same frame; tell them apart by timing.
        const now = Date.now()
        if (now - opened >= TERMINAL_MAX_MS - 60_000) {
          warn("Session closed: shells are limited to 4 hours.")
        } else if (now - lastActivity >= TERMINAL_IDLE_MS - 60_000) {
          warn("Session closed after 10 minutes without activity.")
        } else {
          warn(`Connection closed (${ev.reason || `code ${ev.code}`}).`)
        }
        finish(EXIT.ERROR)
      }
      // Raw mode turns Ctrl-C into a byte for the remote shell; these only come from outside.
      for (const [name, code] of [
        ["SIGTERM", 143],
        ["SIGHUP", 129],
      ] as const) {
        const handler = () => finish(code)
        process.on(name, handler)
        cleanups.push(() => process.off(name, handler))
      }
      const touch = () => {
        lastActivity = Date.now()
      }
      stdin.on("data", touch)
      cleanups.push(() => stdin.off("data", touch))
      cleanups.push(pumpStdin(ws, undefined, () => finish(0)))
    })
  } finally {
    for (const fn of cleanups) fn()
    ws.onmessage = ws.onclose = null
  }
}
