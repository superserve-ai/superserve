import { APIError, SuperserveError } from "./errors"
import { Session } from "./session"
import { AgentStream } from "./stream"
import type {
  Agent,
  APIAgentResponse,
  APISessionResponse,
  RunOptions,
  RunResult,
  SessionOptions,
  StreamOptions,
  SuperserveOptions,
} from "./types"

const DEFAULT_BASE_URL = "https://api.superserve.ai"
const DEFAULT_TIMEOUT = 30_000
const DEFAULT_IDLE_TIMEOUT = 29 * 60 // 29 minutes

/**
 * The main Superserve client for interacting with deployed AI agents.
 *
 * This client provides methods to send messages to agents and manage sessions.
 * It handles authentication, streaming, and error recovery automatically.
 *
 * @class
 * @example
 * ```typescript
 * import Superserve from '@superserve/sdk'
 *
 * const client = new Superserve({
 *   apiKey: 'your-api-key-from-cli'
 * })
 *
 * // One-shot request
 * const result = await client.run('my-agent', {
 *   message: 'What is 2 + 2?'
 * })
 * console.log(result.text) // "4"
 *
 * // Streaming response
 * const stream = client.stream('my-agent', {
 *   message: 'Write a short poem',
 *   onText: (chunk) => process.stdout.write(chunk),
 *   onFinish: () => console.log('\nDone!')
 * })
 * await stream.consume()
 *
 * // Multi-turn conversation
 * const session = await client.createSession('my-agent')
 * const response1 = await session.run('Hello!')
 * const response2 = await session.run('Tell me more')
 * await session.end()
 * ```
 *
 * @throws {APIError} When API returns an error
 * @throws {SuperserveError} When network or other errors occur
 */
export class Superserve {
  private readonly _apiKey: string
  private readonly _baseUrl: string
  private readonly _timeout: number
  private readonly _agentNameCache = new Map<string, string>()

  /** Methods for querying agent information. */
  readonly agents: {
    /** List all agents. */
    list: () => Promise<Agent[]>
    /** Get an agent by name or ID. */
    get: (nameOrId: string) => Promise<Agent>
  }

  constructor(options: SuperserveOptions) {
    this._apiKey = options.apiKey
    this._baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this._timeout = options.timeout ?? DEFAULT_TIMEOUT

    // Bind agent methods
    this.agents = {
      list: () => this._listAgents(),
      get: (nameOrId: string) => this._getAgent(nameOrId),
    }
  }

  /**
   * Send a message to an agent and wait for the complete response.
   *
   * This method creates a session, sends your message, waits for the agent to finish
   * processing, collects the full response, and automatically closes the session.
   * Use this for simple one-shot queries.
   *
   * @param {string} agent - The agent name or ID (e.g., 'my-agent' or 'agt_123')
   * @param {RunOptions} options - Message and session options
   * @param {string} options.message - The message to send to the agent
   * @param {string} [options.sessionId] - Optional existing session ID (for resuming)
   * @param {number} [options.idleTimeout] - Session idle timeout in seconds (default: 1740)
   * @returns {Promise<RunResult>} The agent's response with text and metadata
   *
   * @example
   * ```typescript
   * const result = await client.run('my-agent', {
   *   message: 'Calculate the sum of 5 + 3'
   * })
   * console.log(result.text)
   * ```
   *
   * @throws {APIError} If agent not found or API error occurs
   * @throws {SuperserveError} On network failure or timeout
   */
  async run(agent: string, options: RunOptions): Promise<RunResult> {
    if (options.sessionId) {
      const session = new Session(
        { id: options.sessionId, agentId: "", agentName: undefined, status: "active", messageCount: 0, createdAt: "" },
        this._request.bind(this),
        this._safeJson.bind(this),
      )
      return session.run(options.message)
    }

    const session = await this.createSession(agent, {
      idleTimeout: options.idleTimeout,
    })

    try {
      const result = await session.run(options.message)
      return result
    } finally {
      try {
        await session.end()
      } catch {
        // Best-effort cleanup
      }
    }
  }

  /**
   * Send a message to an agent and receive a streaming response.
   *
   * This method returns an AgentStream that you can iterate over to receive
   * real-time updates as the agent processes your message. This is ideal for
   * long-running operations where you want to display progress to the user.
   *
   * @param {string} agent - The agent name or ID (e.g., 'my-agent' or 'agt_123')
   * @param {StreamOptions} options - Message and stream options
   * @param {string} options.message - The message to send
   * @param {(text: string) => void} [options.onText] - Called when text is streamed
   * @param {(tool: ToolCall) => void} [options.onToolStart] - Called when tool execution starts
   * @param {(result: unknown) => void} [options.onToolEnd] - Called when tool execution ends
   * @param {() => void} [options.onFinish] - Called when streaming completes
   * @param {(error: Error) => void} [options.onError] - Called on error
   * @returns {AgentStream} Async iterable stream of events
   *
   * @example
   * ```typescript
   * const stream = client.stream('my-agent', {
   *   message: 'Generate a story',
   *   onText: (chunk) => {
   *     process.stdout.write(chunk)
   *   },
   *   onFinish: () => {
   *     console.log('\nStory complete!')
   *   }
   * })
   *
   * // Wait for streaming to complete
   * await stream.consume()
   * ```
   *
   * @throws {APIError} If agent not found or API error occurs
   * @throws {SuperserveError} On network failure or timeout
   */
  stream(agent: string, options: StreamOptions): AgentStream {
    const { onText, onToolStart, onToolEnd, onFinish, onError, ...runOpts } =
      options
    const callbacks = { onText, onToolStart, onToolEnd, onFinish, onError }

    if (runOpts.sessionId) {
      const controller = new AbortController()
      const responsePromise = this._request(
        "POST",
        `/sessions/${runOpts.sessionId}/messages`,
        {
          json: { prompt: runOpts.message },
          stream: true,
          signal: controller.signal,
        },
      )
      return new AgentStream(responsePromise, controller, callbacks)
    }

    // Create session then stream — wrap in a single promise chain
    const controller = new AbortController()
    const responsePromise = this._resolveAgentId(agent)
      .then((agentId) =>
        this._createSessionRaw(agentId, undefined, runOpts.idleTimeout),
      )
      .then((sessionData) =>
        this._request("POST", `/sessions/${sessionData.id}/messages`, {
          json: { prompt: runOpts.message },
          stream: true,
          signal: controller.signal,
        }),
      )

    return new AgentStream(responsePromise, controller, callbacks)
  }

  /**
   * Create a new multi-turn conversation session with an agent.
   *
   * Sessions allow you to have a back-and-forth conversation with an agent,
   * maintaining context across multiple messages. The session persists on the
   * server until you explicitly end it or it times out.
   *
   * @param {string} agent - The agent name or ID (e.g., 'my-agent' or 'agt_123')
   * @param {SessionOptions} [options] - Session configuration
   * @param {string} [options.title] - Optional title for the session
   * @param {number} [options.idleTimeout] - Idle timeout in seconds (default: 1740 = 29 minutes)
   * @returns {Promise<Session>} An active session ready for messages
   *
   * @example
   * ```typescript
   * const session = await client.createSession('my-agent', {
   *   title: 'Customer Support Chat'
   * })
   *
   * // First turn
   * const response1 = await session.run('I need help with my account')
   * console.log(response1.text)
   *
   * // Second turn (context preserved)
   * const response2 = await session.run('My email is user@example.com')
   * console.log(response2.text)
   *
   * // Always clean up when done
   * await session.end()
   * ```
   *
   * @throws {APIError} If agent not found or API error occurs
   * @throws {SuperserveError} On network failure or timeout
   */
  async createSession(
    agent: string,
    options: SessionOptions = {},
  ): Promise<Session> {
    const agentId = await this._resolveAgentId(agent)
    const data = await this._createSessionRaw(
      agentId,
      options.title,
      options.idleTimeout,
    )

    const info = mapSession(data)
    return new Session(info, this._request.bind(this), this._safeJson.bind(this))
  }

  // ==================== Internal Methods ====================

  /** @internal */
  async _request(
    method: string,
    endpoint: string,
    options: {
      json?: unknown
      params?: Record<string, string>
      stream?: boolean
      signal?: AbortSignal
    } = {},
  ): Promise<Response> {
    const { json, params, stream = false, signal } = options

    let url = `${this._baseUrl}/v1${endpoint}`
    if (params) {
      url += `?${new URLSearchParams(params).toString()}`
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this._apiKey}`,
      "Content-Type": "application/json",
    }

    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (!stream) {
      timeoutId = setTimeout(() => controller.abort(), this._timeout)
    }

    // Combine external signal with timeout
    const combinedSignal = signal
      ? anySignal([signal, controller.signal])
      : controller.signal

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: json ? JSON.stringify(json) : undefined,
        signal: combinedSignal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (response.status >= 400) {
        let errorData: Record<string, unknown> = {}
        try {
          errorData = (await response.json()) as Record<string, unknown>
        } catch {
          // ignore parse errors
        }

        const detail = (errorData.detail ?? errorData.message) as string | undefined
        throw new APIError(
          response.status,
          detail ?? response.statusText,
          (errorData.details as Record<string, unknown>) ?? undefined,
        )
      }

      return response
    } catch (e) {
      if (timeoutId) clearTimeout(timeoutId)
      if (e instanceof APIError) throw e
      if (e instanceof DOMException && e.name === "AbortError") {
        if (signal?.aborted) {
          throw new SuperserveError("Request was aborted")
        }
        throw new APIError(0, "Request timed out")
      }
      throw new APIError(0, "Network request failed")
    }
  }

  /** @internal */
  async _safeJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T
    } catch {
      throw new APIError(
        response.status,
        "Unexpected response from server",
      )
    }
  }

  private async _resolveAgentId(nameOrId: string): Promise<string> {
    if (nameOrId.startsWith("agt_")) return nameOrId

    const cached = this._agentNameCache.get(nameOrId)
    if (cached) return cached

    const resp = await this._request("GET", "/agents")
    const data = await this._safeJson<{ agents?: APIAgentResponse[] }>(resp)
    const agents = data.agents ?? []

    for (const agent of agents) {
      this._agentNameCache.set(agent.name, agent.id)
    }

    const resolved = this._agentNameCache.get(nameOrId)
    if (resolved) return resolved

    throw new APIError(404, `Agent '${nameOrId}' not found`)
  }

  private async _createSessionRaw(
    agentId: string,
    title?: string,
    idleTimeout?: number,
  ): Promise<APISessionResponse> {
    const resp = await this._request("POST", "/sessions", {
      json: {
        agent_id: agentId,
        title,
        idle_timeout_seconds: idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
      },
    })
    return this._safeJson<APISessionResponse>(resp)
  }

  private async _listAgents(): Promise<Agent[]> {
    const resp = await this._request("GET", "/agents")
    const data = await this._safeJson<{ agents?: APIAgentResponse[] }>(resp)
    return (data.agents ?? []).map(mapAgent)
  }

  private async _getAgent(nameOrId: string): Promise<Agent> {
    const agentId = await this._resolveAgentId(nameOrId)
    const resp = await this._request("GET", `/agents/${agentId}`)
    const data = await this._safeJson<APIAgentResponse>(resp)
    return mapAgent(data)
  }
}

// ==================== Helpers ====================

function mapAgent(raw: APIAgentResponse): Agent {
  return {
    id: raw.id,
    name: raw.name,
    command: raw.command,
    depsStatus: raw.deps_status,
    depsError: raw.deps_error,
    requiredSecrets: raw.required_secrets,
    environmentKeys: raw.environment_keys,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function mapSession(raw: APISessionResponse): {
  id: string
  agentId: string
  agentName?: string
  status: string
  title?: string
  messageCount: number
  createdAt: string
} {
  return {
    id: raw.id,
    agentId: raw.agent_id,
    agentName: raw.agent_name,
    status: raw.status,
    title: raw.title,
    messageCount: raw.message_count,
    createdAt: raw.created_at,
  }
}

/**
 * Combines multiple AbortSignals into one that aborts when any of them does.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    })
  }
  return controller.signal
}
