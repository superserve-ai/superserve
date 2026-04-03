import { parseSSEStream } from "./sse"
import type { ApiExecStreamEvent, ExecResult, ExecStreamEvent } from "./types"

export class ExecStream implements AsyncIterable<ExecStreamEvent> {
  private readonly _responsePromise: Promise<Response>
  private readonly _controller: AbortController
  private _resultResolve!: (result: ExecResult) => void
  private _resultReject!: (error: Error) => void
  private _consumed = false
  readonly result: Promise<ExecResult>

  constructor(
    responsePromise: Promise<Response>,
    controller: AbortController,
  ) {
    this._responsePromise = responsePromise
    this._controller = controller
    this.result = new Promise<ExecResult>((resolve, reject) => {
      this._resultResolve = resolve
      this._resultReject = reject
    })
  }

  abort(): void {
    this._controller.abort()
  }

  get stdout(): AsyncIterable<string> {
    return this._filter("stdout")
  }

  get stderr(): AsyncIterable<string> {
    return this._filter("stderr")
  }

  private async *_filter(type: "stdout" | "stderr"): AsyncIterable<string> {
    for await (const event of this) {
      if (event.type === type) {
        yield event.data
      }
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ExecStreamEvent> {
    if (this._consumed) {
      throw new Error("ExecStream can only be iterated once")
    }
    this._consumed = true

    let stdout = ""
    let stderr = ""
    let exitCode = 0

    try {
      const response = await this._responsePromise

      for await (const raw of parseSSEStream<ApiExecStreamEvent>(response)) {
        if (raw.stdout) {
          stdout += raw.stdout
          yield { type: "stdout", data: raw.stdout }
        }
        if (raw.stderr) {
          stderr += raw.stderr
          yield { type: "stderr", data: raw.stderr }
        }
        if (raw.finished && raw.exit_code !== undefined) {
          exitCode = raw.exit_code
          yield { type: "exit", exitCode: raw.exit_code }
        }
      }

      this._resultResolve({ stdout, stderr, exitCode })
    } catch (e) {
      this._resultReject(e instanceof Error ? e : new Error(String(e)))
      throw e
    }
  }
}
