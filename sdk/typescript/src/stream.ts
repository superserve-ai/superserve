import { parseSSEStream } from "./sse"
import type {
  APIRunEvent,
  RunResult,
  StreamEvent,
  StreamOptions,
  ToolCall,
} from "./types"

/**
 * An async iterable stream of agent events.
 *
 * @example
 * ```ts
 * // Iterate over all events
 * for await (const event of stream) {
 *   if (event.type === 'text') console.log(event.content)
 * }
 *
 * // Or just get the text
 * for await (const chunk of stream.textStream) {
 *   process.stdout.write(chunk)
 * }
 *
 * // Get the final result after iterating
 * const result = await stream.result
 * ```
 */
export class AgentStream implements AsyncIterable<StreamEvent> {
  private readonly _response: Promise<Response>
  private readonly _abortController: AbortController
  private readonly _callbacks: Pick<
    StreamOptions,
    "onText" | "onToolStart" | "onToolEnd" | "onFinish" | "onError"
  >
  private _consumed = false

  // Result tracking — built up as events flow through any iteration
  private _text = ""
  private _toolCalls: ToolCall[] = []
  private _currentTool: { name: string; input: unknown } | null = null
  private _finishReason: RunResult["finishReason"] = "completed"
  private _duration = 0
  private _maxTurnsReached = false
  private _done = false

  private _resultResolve!: (result: RunResult) => void
  private _resultReject!: (err: Error) => void
  private _resultPromise: Promise<RunResult>

  /** @internal */
  constructor(
    response: Promise<Response>,
    abortController: AbortController,
    callbacks: Pick<
      StreamOptions,
      "onText" | "onToolStart" | "onToolEnd" | "onFinish" | "onError"
    > = {},
  ) {
    this._response = response
    this._abortController = abortController
    this._callbacks = callbacks
    this._resultPromise = new Promise<RunResult>((resolve, reject) => {
      this._resultResolve = resolve
      this._resultReject = reject
    })
  }

  /** Abort the stream. */
  abort(): void {
    this._abortController.abort()
  }

  /**
   * A promise that resolves with the final RunResult once the stream completes.
   * If the stream has not been iterated yet, this will consume it automatically.
   */
  get result(): Promise<RunResult> {
    // Auto-consume if nobody has iterated yet
    if (!this._consumed) {
      this._consume()
    }
    return this._resultPromise
  }

  /**
   * Async iterable that yields only text chunks.
   *
   * @example
   * ```ts
   * for await (const text of stream.textStream) {
   *   process.stdout.write(text)
   * }
   * ```
   */
  get textStream(): AsyncIterable<string> {
    const self = this
    return {
      [Symbol.asyncIterator]() {
        return (async function* () {
          for await (const event of self) {
            if (event.type === "text") {
              yield event.content
            }
          }
        })()
      },
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    if (this._consumed) {
      throw new Error("AgentStream can only be iterated once")
    }
    this._consumed = true

    try {
      const response = await this._response
      for await (const apiEvent of parseSSEStream(response)) {
        const event = mapEvent(apiEvent)
        if (!event) continue

        // Track result state
        this._trackEvent(event)

        // Fire callbacks
        this._fireCallback(event)

        yield event
      }

      this._resolveResult()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this._resultReject(error)
      throw err
    }
  }

  /** Consume the stream in the background without yielding events. */
  private async _consume(): Promise<void> {
    if (this._consumed) return
    this._consumed = true

    try {
      const response = await this._response
      for await (const apiEvent of parseSSEStream(response)) {
        const event = mapEvent(apiEvent)
        if (!event) continue
        this._trackEvent(event)
        this._fireCallback(event)
      }
      this._resolveResult()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this._resultReject(error)
    }
  }

  private _trackEvent(event: StreamEvent): void {
    switch (event.type) {
      case "text":
        this._text += event.content
        break
      case "tool-start":
        this._currentTool = { name: event.name, input: event.input }
        break
      case "tool-end":
        if (this._currentTool) {
          this._toolCalls.push({
            ...this._currentTool,
            duration: event.duration,
          })
          this._currentTool = null
        }
        break
      case "run-completed":
        this._duration = event.duration
        this._maxTurnsReached = event.maxTurnsReached
        this._finishReason = "completed"
        break
      case "run-failed":
        this._finishReason = "failed"
        break
    }
  }

  private _fireCallback(event: StreamEvent): void {
    switch (event.type) {
      case "text":
        this._callbacks.onText?.(event.content)
        break
      case "tool-start":
        this._callbacks.onToolStart?.(event)
        break
      case "tool-end":
        this._callbacks.onToolEnd?.(event)
        break
    }
  }

  private _resolveResult(): void {
    if (this._done) return
    this._done = true

    const result: RunResult = {
      text: this._text,
      toolCalls: this._toolCalls,
      finishReason: this._finishReason,
      duration: this._duration,
      maxTurnsReached: this._maxTurnsReached,
    }

    if (this._finishReason === "completed") {
      this._callbacks.onFinish?.(result)
    } else if (this._finishReason === "failed") {
      this._callbacks.onError?.(new Error("Run failed"))
    }

    this._resultResolve(result)
  }
}

/** Maps API SSE events to public SDK events. */
function mapEvent(apiEvent: APIRunEvent): StreamEvent | null {
  switch (apiEvent.type) {
    case "message.delta":
      return {
        type: "text",
        content: apiEvent.data.content ?? "",
      }
    case "tool.start":
      return {
        type: "tool-start",
        name: apiEvent.data.tool ?? "unknown",
        input: apiEvent.data.input,
      }
    case "tool.end":
      return {
        type: "tool-end",
        duration: apiEvent.data.duration_ms ?? 0,
      }
    case "run.completed":
      return {
        type: "run-completed",
        duration: apiEvent.data.duration_ms ?? 0,
        maxTurnsReached: apiEvent.data.max_turns_reached ?? false,
      }
    case "run.failed":
      return {
        type: "run-failed",
        error: apiEvent.data.error?.message ?? "Unknown error",
      }
    // Ignore status, heartbeat, run.started, run.cancelled
    default:
      return null
  }
}
