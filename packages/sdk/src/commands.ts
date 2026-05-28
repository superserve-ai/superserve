/**
 * `sandbox.commands` - run shell commands inside a sandbox.
 *
 * Hits the per-sandbox data plane with the access token. On 401 the
 * SDK auto-refreshes via `POST /activate` and retries once.
 *
 * Accessed as `sandbox.commands.run(...)`.
 */

import { dataPlaneTarget } from "./config.js"
import { AuthenticationError, SandboxError } from "./errors.js"
import { request, streamSSE } from "./http.js"
import type {
  ApiExecResult,
  ApiExecStreamEvent,
  CommandOptions,
  CommandResult,
} from "./types.js"

/** @internal */
export interface CommandsDeps {
  sandboxId: string
  sandboxHost: string
  getAccessToken: () => string
  refreshActivate: () => Promise<string>
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
    const { cwd, env, timeoutMs, onStdout, onStderr } = options
    const isStreaming = onStdout !== undefined || onStderr !== undefined

    const body: Record<string, unknown> = { command }
    if (cwd !== undefined) body.working_dir = cwd
    if (env !== undefined) body.env = env
    // API expects seconds; convert from ms
    if (timeoutMs !== undefined) body.timeout_s = Math.ceil(timeoutMs / 1000)

    if (isStreaming) {
      return this._runStreaming(body, options)
    }
    return this._runSync(body, options)
  }

  private async _runSync(
    body: Record<string, unknown>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const send = (token: string) =>
      request<ApiExecResult>({
        method: "POST",
        url: `${this._dataPlaneBaseUrl}/exec`,
        headers: { ...this._routingHeaders, "X-Access-Token": token },
        body,
        // Add a 5s buffer so the server-side command timeout fires first
        // and returns its proper response before the client aborts.
        timeoutMs:
          options.timeoutMs !== undefined
            ? options.timeoutMs + 5_000
            : undefined,
        signal: options.signal,
      })

    const raw = await this._withTokenRetry(send)
    return {
      stdout: raw.stdout ?? "",
      stderr: raw.stderr ?? "",
      exitCode: raw.exit_code ?? 0,
    }
  }

  private async _runStreaming(
    body: Record<string, unknown>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const send = async (token: string) =>
      this._consumeStream(
        `${this._dataPlaneBaseUrl}/exec/stream`,
        { ...this._routingHeaders, "X-Access-Token": token },
        body,
        options,
      )
    return this._withTokenRetry(send)
  }

  // Safe for streaming: 401 is returned in the HTTP status code before
  // any SSE data is written, so the retry can't double-emit callbacks.
  // The try/catch wraps `send` only — if `refreshActivate` itself 401s
  // (bad API key), it propagates uncaught, so no recursion is possible.
  private async _withTokenRetry<T>(
    send: (token: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await send(this._deps.getAccessToken())
    } catch (err) {
      if (!(err instanceof AuthenticationError)) throw err
      const fresh = await this._deps.refreshActivate()
      return send(fresh)
    }
  }

  private async _consumeStream(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    let stdout = ""
    let stderr = ""
    let exitCode = 0
    let error: string | undefined
    let sawFinished = false

    await streamSSE({
      url,
      headers,
      body,
      timeoutMs:
        options.timeoutMs !== undefined ? options.timeoutMs + 5_000 : undefined,
      signal: options.signal,
      onEvent: (event: ApiExecStreamEvent) => {
        if (event.stdout) {
          stdout += event.stdout
          options.onStdout?.(event.stdout)
        }
        if (event.stderr) {
          stderr += event.stderr
          options.onStderr?.(event.stderr)
        }
        if (event.finished) {
          sawFinished = true
          exitCode = event.exit_code ?? 0
          error = event.error
        }
      },
    })

    if (!sawFinished) {
      throw new SandboxError(
        "Command stream ended without a finished event (possible network disconnect)",
      )
    }

    if (error) {
      stderr += error
    }

    return { stdout, stderr, exitCode }
  }
}
