import { spawnCommand } from "./commandSession.js"
/**
 * `sandbox.commands` - run shell commands inside a sandbox.
 *
 * Hits the per-sandbox data plane with the access token. A paused sandbox
 * (401 stale token, or 503 because the VM isn't running) is transparently
 * resumed via `POST /activate` and the call is retried once — see
 * `tokenRetry.ts`.
 *
 * Accessed as `sandbox.commands.run(...)`.
 */
import { dataPlaneTarget } from "./config.js"
import { SandboxError, ValidationError } from "./errors.js"
import { composeSignals, request, streamSSE } from "./http.js"
import { routingHintHeaders } from "./routingHint.js"
import { withTokenRetry } from "./tokenRetry.js"
import type {
  ApiExecResult,
  ApiExecStreamEvent,
  CommandOptions,
  CommandResult,
  CommandSession,
  SpawnOptions,
} from "./types.js"

/** @internal */
export interface CommandsDeps {
  sandboxId: string
  sandboxHost: string
  getAccessToken: () => string
  getRoutingHint?: () => string | undefined
  refreshActivate: () => Promise<string>
}

/**
 * Max bytes read from a non-streaming `/exec` response before the SDK aborts
 * the read and throws `ValidationError`.
 *
 * The data plane is untrusted: `boxd`'s sync exec handler buffers the command's
 * full stdout/stderr in the VM and returns it in one JSON body, and neither the
 * data-plane proxy nor `fetch` caps that body — so a command can stream back as
 * much output as the sandbox has RAM. Buffering it unbounded into memory is a
 * DoS vector for any shared host (e.g. the hosted MCP server). Callers that
 * genuinely need large output should stream via `onStdout`/`onStderr` instead.
 */
export const MAX_EXEC_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MiB

// How long the client waits past the server's command deadline, so the server
// can kill the command and return its result before the client aborts.
const SERVER_DEADLINE_MARGIN_MS = 5_000

/**
 * Largest accepted `timeoutMs`: the client deadline (rounded up to whole
 * seconds, plus the margin) must fit a timer, which fires at once for delays
 * over 2^31 - 1 ms.
 */
export const MAX_COMMAND_TIMEOUT_MS =
  Math.floor((2 ** 31 - 1 - SERVER_DEADLINE_MARGIN_MS) / 1000) * 1000

// The server's `timeout_s` for a `timeoutMs`; undefined when it is omitted or 0,
// so neither sends one and both keep the HTTP layer's default deadline.
function commandTimeoutSeconds(timeoutMs: number | undefined) {
  if (timeoutMs === undefined || timeoutMs === 0) return undefined
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_COMMAND_TIMEOUT_MS
  ) {
    throw new ValidationError(
      `timeoutMs must be between 0 and ${MAX_COMMAND_TIMEOUT_MS}, got ${timeoutMs}`,
    )
  }
  return Math.ceil(timeoutMs / 1000)
}

/**
 * Longest `timeout_s` a `run()` without callbacks sends to `/exec`. That
 * endpoint sends no response headers until the command ends, and Node's
 * built-in `fetch` (undici) fails any response whose headers take longer than
 * 300 s (`UND_ERR_HEADERS_TIMEOUT`), whatever `timeoutMs` is. A longer run goes
 * through `/exec/stream` instead: the sandbox sends keepalive comments on it
 * while the command runs, so the connection stays open, and the SDK collects
 * the output into the same result.
 */
export const MAX_SYNC_EXEC_TIMEOUT_S = 240

/**
 * Bytes of combined stdout/stderr a long `run()` without callbacks keeps, the
 * same cap the sandbox applies to `/exec` output. The rest is dropped and
 * `truncated` is set, as for `/exec`.
 */
export const SYNC_EXEC_OUTPUT_CAP_BYTES = 8 * 1024 * 1024

function clientDeadlineMs(timeoutS: number | undefined) {
  return timeoutS === undefined
    ? undefined
    : timeoutS * 1000 + SERVER_DEADLINE_MARGIN_MS
}

export class Commands {
  private readonly _dataPlaneBaseUrl: string
  private readonly _routingHeaders: Record<string, string>

  /** @internal */
  constructor(private readonly _deps: CommandsDeps) {
    const target = dataPlaneTarget(_deps.sandboxId, _deps.sandboxHost)
    this._dataPlaneBaseUrl = target.url
    this._routingHeaders = target.headers
  }

  /**
   * Execute a command inside the sandbox.
   *
   * If `onStdout` or `onStderr` callbacks are provided, the command is
   * streamed via SSE. Otherwise, it runs synchronously (waits for completion).
   *
   * Paused sandboxes are transparently resumed before execution.
   *
   * Without callbacks and with a `timeoutMs` over 240 s, the command runs
   * over the streaming endpoint and the output is collected, because the
   * synchronous endpoint sends no response until the command ends and Node's
   * `fetch` gives up on a response after 300 s.
   *
   * @example
   * ```typescript
   * // Synchronous
   * const result = await sandbox.commands.run("echo hello")
   * console.log(result.stdout) // "hello\n"
   *
   * // Streaming
   * const result = await sandbox.commands.run("npm start", {
   *   onStdout: (data) => process.stdout.write(data),
   *   onStderr: (data) => process.stderr.write(data),
   *   timeoutMs: 120_000,
   * })
   * ```
   */
  async run(
    command: string,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    const { cwd, user, env, timeoutMs, onStdout, onStderr } = options
    const isStreaming = onStdout !== undefined || onStderr !== undefined
    // API expects seconds; convert from ms
    const timeoutS = commandTimeoutSeconds(timeoutMs)

    const body: Record<string, unknown> = { command }
    if (cwd !== undefined) body.working_dir = cwd
    if (user !== undefined) body.user = user
    if (env !== undefined) body.env = env
    if (timeoutS !== undefined) body.timeout_s = timeoutS

    if (isStreaming) {
      return this._runStreaming(body, timeoutS, options)
    }
    if (timeoutS !== undefined && timeoutS > MAX_SYNC_EXEC_TIMEOUT_S) {
      const limit = options.maxOutputBytes ?? MAX_EXEC_RESPONSE_BYTES
      return this._runStreaming(body, timeoutS, options, {
        capBytes: Math.min(SYNC_EXEC_OUTPUT_CAP_BYTES, limit),
        // A caller-set cap below the sandbox's own cap throws, as on `/exec`.
        throwOverCap: limit < SYNC_EXEC_OUTPUT_CAP_BYTES,
      })
    }
    return this._runSync(body, timeoutS, options)
  }

  /**
   * Spawn a command and return a live, full-duplex session.
   *
   * Unlike `run` (one-shot), `spawn` hands back a handle while the process is
   * still running: stream output via `onStdout`/`onStderr`, write to its
   * `stdin`, `kill` it, and `await session.wait()` for the exit result.
   *
   * Release the session when you're done (use `await using`, or call `wait()`
   * or `close()`) so the socket and its reader are cleaned up.
   *
   * A paused sandbox is resumed transparently before the session opens.
   *
   * @example
   * ```typescript
   * const session = await sandbox.commands.spawn("python -i", {
   *   onStdout: (data) => process.stdout.write(data),
   * })
   * session.stdin.write("print(2 + 2)\n")
   * session.stdin.close()
   * const { exitCode } = await session.wait()
   * ```
   */
  spawn(command: string, options: SpawnOptions = {}): Promise<CommandSession> {
    return spawnCommand(this._deps, command, options)
  }

  private async _runSync(
    body: Record<string, unknown>,
    timeoutS: number | undefined,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const send = (token: string) =>
      request<ApiExecResult>({
        method: "POST",
        url: `${this._dataPlaneBaseUrl}/exec`,
        headers: {
          ...this._routingHeaders,
          ...routingHintHeaders(this._deps),
          "X-Access-Token": token,
        },
        body,
        // Add a 5s buffer so the server-side command timeout fires first
        // and returns its proper response before the client aborts.
        timeoutMs: clientDeadlineMs(timeoutS),
        signal: options.signal,
        // The data plane is untrusted — bound the buffered response so a
        // command's runaway stdout/stderr can't exhaust the caller's memory.
        maxBytes: options.maxOutputBytes ?? MAX_EXEC_RESPONSE_BYTES,
      })

    const raw = await withTokenRetry(this._deps, send)
    return {
      stdout: raw.stdout ?? "",
      stderr: raw.stderr ?? "",
      exitCode: raw.exit_code ?? 0,
      truncated: raw.truncated ?? false,
    }
  }

  private async _runStreaming(
    body: Record<string, unknown>,
    timeoutS: number | undefined,
    options: CommandOptions,
    collect?: OutputCap,
  ): Promise<CommandResult> {
    const send = async (token: string) =>
      this._consumeStream(
        `${this._dataPlaneBaseUrl}/exec/stream`,
        {
          ...this._routingHeaders,
          ...routingHintHeaders(this._deps),
          "X-Access-Token": token,
        },
        body,
        timeoutS,
        options,
        collect,
      )
    // Safe for streaming: the resumable status (401/503) is returned before any
    // SSE data is written, so a retry can't double-emit callbacks.
    return withTokenRetry(this._deps, send)
  }

  private async _consumeStream(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    timeoutS: number | undefined,
    options: CommandOptions,
    collect?: OutputCap,
  ): Promise<CommandResult> {
    let stdout = ""
    let stderr = ""
    let exitCode = 0
    let error: string | undefined
    let sawFinished = false

    // Only a long run without callbacks (see MAX_SYNC_EXEC_TIMEOUT_S) caps
    // what it keeps; a caller with callbacks gets every chunk, as before.
    const encoder = new TextEncoder()
    let kept = 0
    let truncated = false
    let overCap = false
    const stop = collect ? new AbortController() : undefined
    const keep = (chunk: string): string => {
      if (!collect) return chunk
      if (truncated) return ""
      const bytes = encoder.encode(chunk)
      if (kept + bytes.byteLength <= collect.capBytes) {
        kept += bytes.byteLength
        return chunk
      }
      if (collect.throwOverCap) {
        overCap = true
        stop?.abort()
        return ""
      }
      truncated = true
      // stream: true holds back a split multi-byte character.
      const part = new TextDecoder().decode(
        bytes.subarray(0, collect.capBytes - kept),
        { stream: true },
      )
      kept = collect.capBytes
      return part
    }

    const composed = stop
      ? composeSignals(stop.signal, options.signal)
      : undefined
    try {
      await streamSSE({
        url,
        headers,
        body,
        timeoutMs: clientDeadlineMs(timeoutS),
        signal: composed ? composed.signal : options.signal,
        onEvent: (event: ApiExecStreamEvent) => {
          if (event.stdout) {
            stdout += keep(event.stdout)
            options.onStdout?.(event.stdout)
          }
          if (event.stderr) {
            stderr += keep(event.stderr)
            options.onStderr?.(event.stderr)
          }
          if (event.finished) {
            sawFinished = true
            exitCode = event.exit_code ?? 0
            error = event.error
          }
        },
      })
    } catch (err) {
      if (!overCap) throw err
    } finally {
      composed?.release()
    }
    // The stream can end before the abort lands, so check after it too.
    if (overCap) {
      throw new ValidationError(
        `Command output exceeds the maximum size of ${collect?.capBytes} bytes`,
      )
    }

    if (!sawFinished) {
      throw new SandboxError(
        "Command stream ended without a finished event (possible network disconnect)",
      )
    }

    if (error) {
      stderr += error
    }

    if (truncated) {
      stderr += `\n[superserve] output truncated: combined stdout/stderr exceeded ${collect?.capBytes} bytes; pass onStdout/onStderr for full output\n`
    }
    return { stdout, stderr, exitCode, truncated }
  }
}

interface OutputCap {
  /** Most bytes of combined stdout/stderr to keep. */
  capBytes: number
  /** Throw `ValidationError` past the cap instead of truncating. */
  throwOverCap: boolean
}
