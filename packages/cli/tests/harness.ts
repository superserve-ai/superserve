import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import { run } from "../src/cli"

/**
 * Runs the CLI in-process with a stubbed `fetch`, so a test asserts on the
 * exact requests a command sends (control plane and data plane alike) and on
 * its stdout, stderr and exit code. Nothing touches the network or ~/.superserve.
 */

// Region-tagged like a real key: routes to api.superserve.ai / sandbox.superserve.ai.
export const TEST_KEY = `ss_live_use_${"A".repeat(32)}`
export const API = "https://api.superserve.ai"
export const SANDBOX_ID = "11111111-2222-4333-8444-555555555555"

export interface RecordedRequest {
  method: string
  url: URL
  headers: Headers
  body: string | undefined
  /** Exact body bytes, for binary-fidelity assertions. */
  bodyBytes: Uint8Array | undefined
  /** Parsed JSON body (throws if the body isn't JSON). */
  json(): any
}

export type FetchHandler = (
  req: RecordedRequest,
) => Response | Promise<Response> | undefined

export interface RunOptions {
  /** Answer each request; return undefined to fail the test on an unexpected call. */
  fetch?: FetchHandler
  /** Overrides on top of the test defaults; `undefined` unsets a variable. */
  env?: Record<string, string | undefined>
  /** Piped stdin contents. Omitted: an empty, non-TTY stdin. */
  stdin?: string | Uint8Array
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  requests: RecordedRequest[]
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

export function apiError(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status)
}

async function bodyBytes(init?: RequestInit): Promise<Uint8Array | undefined> {
  const b = init?.body
  if (b === undefined || b === null) return undefined
  return new Uint8Array(await new Response(b).arrayBuffer())
}

export async function runCli(
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  // A caller-supplied SUPERSERVE_CONFIG_DIR persists across runs (login tests).
  const ownDir = !opts.env?.SUPERSERVE_CONFIG_DIR
  const configDir = ownDir
    ? mkdtempSync(join(tmpdir(), "superserve-cli-test-"))
    : (opts.env?.SUPERSERVE_CONFIG_DIR as string)
  const env: Record<string, string | undefined> = {
    SUPERSERVE_API_KEY: TEST_KEY,
    SUPERSERVE_BASE_URL: undefined,
    SUPERSERVE_CONFIG_DIR: configDir,
    SUPERSERVE_TELEMETRY: "0",
    NO_COLOR: "1",
    ...opts.env,
  }
  const savedEnv: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(env)) {
    savedEnv[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  const requests: RecordedRequest[] = []
  const savedFetch = globalThis.fetch
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const bytes = await bodyBytes(init)
    const text = bytes && new TextDecoder().decode(bytes)
    const req: RecordedRequest = {
      method: (init?.method ?? "GET").toUpperCase(),
      url,
      headers: new Headers(init?.headers),
      body: text,
      bodyBytes: bytes,
      json: () => JSON.parse(text ?? ""),
    }
    requests.push(req)
    const res = await opts.fetch?.(req)
    if (!res) throw new Error(`unexpected request: ${req.method} ${url}`)
    return res
  }) as typeof fetch

  let stdout = ""
  let stderr = ""
  const savedOut = process.stdout.write
  const savedErr = process.stderr.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
    return true
  }) as typeof process.stderr.write

  const savedStdin = Object.getOwnPropertyDescriptor(process, "stdin")
  const stdin = Readable.from(
    opts.stdin === undefined ? [] : [Buffer.from(opts.stdin)],
  ) as Readable & { isTTY?: boolean }
  stdin.isTTY = false
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true })

  const savedExitCode = process.exitCode
  try {
    const exitCode = await run(args)
    return { exitCode, stdout, stderr, requests }
  } finally {
    process.exitCode = savedExitCode
    process.stdout.write = savedOut
    process.stderr.write = savedErr
    globalThis.fetch = savedFetch
    if (savedStdin) Object.defineProperty(process, "stdin", savedStdin)
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    if (ownDir) rmSync(configDir, { recursive: true, force: true })
  }
}
