/**
 * Commands sub-module for executing shell commands inside a sandbox.
 *
 * Supports two modes:
 * - Synchronous: waits for command to finish, returns stdout/stderr/exitCode
 * - Streaming: fires onStdout/onStderr callbacks via SSE, then returns result
 *
 * Accessed as `sandbox.commands.run(...)`.
 */

import { request, streamSSE } from "./http.js"
import type {
  ApiExecResult,
  ApiExecStreamEvent,
  CommandOptions,
  CommandResult,
} from "./types.js"

export class Commands {
  /** @internal */
  constructor(
    private readonly _baseUrl: string,
    private readonly _sandboxId: string,
    private readonly _apiKey: string,
  ) {}

  /**
   * Execute a command inside the sandbox.
   *
   * If `onStdout` or `onStderr` callbacks are provided, the command is
   * streamed via SSE. Otherwise, it runs synchronously (waits for completion).
   *
   * Idle sandboxes are automatically resumed by the API before execution.
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
   *   timeoutSeconds: 120,
   * })
   * ```
   */
  async run(
    command: string,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    const { cwd, env, timeoutSeconds, onStdout, onStderr } = options
    const isStreaming = onStdout !== undefined || onStderr !== undefined

    const body: Record<string, unknown> = { command }
    if (cwd !== undefined) body.working_dir = cwd
    if (env !== undefined) body.env = env
    if (timeoutSeconds !== undefined) body.timeout_s = timeoutSeconds

    const authHeaders = { "X-API-Key": this._apiKey }

    if (isStreaming) {
      return this._runStreaming(body, authHeaders, options)
    }
    return this._runSync(body, authHeaders, options)
  }

  private async _runSync(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const raw = await request<ApiExecResult>({
      method: "POST",
      url: `${this._baseUrl}/sandboxes/${this._sandboxId}/exec`,
      headers,
      body,
      timeoutMs:
        options.timeoutSeconds !== undefined
          ? options.timeoutSeconds * 1000 + 5000
          : undefined,
    })
    return {
      stdout: raw.stdout ?? "",
      stderr: raw.stderr ?? "",
      exitCode: raw.exit_code ?? 0,
    }
  }

  private async _runStreaming(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    let stdout = ""
    let stderr = ""
    let exitCode = 0
    let error: string | undefined

    await streamSSE({
      url: `${this._baseUrl}/sandboxes/${this._sandboxId}/exec/stream`,
      headers,
      body,
      timeoutMs:
        options.timeoutSeconds !== undefined
          ? options.timeoutSeconds * 1000 + 5000
          : undefined,
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
          exitCode = event.exit_code ?? 0
          error = event.error
        }
      },
    })

    if (error) {
      stderr += error
    }

    return { stdout, stderr, exitCode }
  }
}
