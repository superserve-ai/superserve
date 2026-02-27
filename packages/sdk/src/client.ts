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
 * The Superserve client for interacting with deployed agents.
 *
 * @example
 * ```ts
 * import Superserve from 'superserve'
 *
 * const client = new Superserve({ apiKey: 'your-token-from-cli' })
 *
 * // One-shot
 * const result = await client.run('my-agent', {
 *   message: 'Hello!'
 * })
 * console.log(result.text)
 *
 * // Streaming
 * const stream = client.stream('my-agent', {
 *   message: 'Write a report...'
 * })
 * for await (const chunk of stream.textStream) {
 *   process.stdout.write(chunk)
 * }
 * ```
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
   * Send a message to an agent and wait for the full response.
   * Creates a session, sends the message, collects the response, and ends the session.
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
   * Send a message to an agent and get a streaming response.
   * Creates a session and returns an AgentStream you can iterate over.
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
   * Create a multi-turn session with an agent.
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
