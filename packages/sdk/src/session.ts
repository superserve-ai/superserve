import { AgentStream } from "./stream"
import type { RunResult, SessionInfo, StreamOptions } from "./types"

type RequestFn = (
  method: string,
  endpoint: string,
  options?: {
    json?: unknown
    params?: Record<string, string>
    stream?: boolean
    signal?: AbortSignal
  },
) => Promise<Response>

type SafeJsonFn = <T>(response: Response) => Promise<T>

/**
 * A multi-turn conversation session with an agent.
 *
 * @example
 * ```ts
 * const session = await client.createSession('my-agent')
 *
 * const r1 = await session.run('What files are in the project?')
 * console.log(r1.text)
 *
 * const stream = session.stream('Now refactor the main module')
 * for await (const chunk of stream.textStream) {
 *   process.stdout.write(chunk)
 * }
 *
 * await session.end()
 * ```
 */
export class Session {
  readonly id: string
  readonly agentId: string
  readonly info: SessionInfo

  private readonly _request: RequestFn
  private readonly _safeJson: SafeJsonFn

  /** @internal */
  constructor(
    info: SessionInfo,
    request: RequestFn,
    safeJson: SafeJsonFn,
  ) {
    this.id = info.id
    this.agentId = info.agentId
    this.info = info
    this._request = request
    this._safeJson = safeJson
  }

  /**
   * Send a message and wait for the full response.
   */
  async run(message: string): Promise<RunResult> {
    const stream = this.stream(message)
    return stream.result
  }

  /**
   * Send a message and get a streaming response.
   */
  stream(
    message: string,
    options: Pick<
      StreamOptions,
      "onText" | "onToolStart" | "onToolEnd" | "onFinish" | "onError"
    > = {},
  ): AgentStream {
    const controller = new AbortController()
    const responsePromise = this._request(
      "POST",
      `/sessions/${this.id}/messages`,
      {
        json: { prompt: message },
        stream: true,
        signal: controller.signal,
      },
    )

    return new AgentStream(responsePromise, controller, options)
  }

  /**
   * End this session.
   */
  async end(): Promise<void> {
    await this._request("POST", `/sessions/${this.id}/end`)
  }
}
