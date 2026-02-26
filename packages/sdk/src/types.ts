// ==================== Client Options ====================

export interface SuperserveOptions {
  /** API key for authentication. This is the same token you get from `superserve login`. */
  apiKey: string
  /** Base URL for the Superserve API. Defaults to https://api-staging.superserve.ai */
  baseUrl?: string
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number
}

// ==================== Run / Stream Options ====================

export interface RunOptions {
  /** The message to send to the agent. */
  message: string
  /** Reuse an existing session ID instead of creating a new one. */
  sessionId?: string
  /** Session idle timeout in seconds. Defaults to 30 days. */
  idleTimeout?: number
}

export interface StreamOptions extends RunOptions {
  /** Called for each text chunk as it arrives. */
  onText?: (text: string) => void
  /** Called when the agent starts using a tool. */
  onToolStart?: (event: ToolStartEvent) => void
  /** Called when a tool invocation completes. */
  onToolEnd?: (event: ToolEndEvent) => void
  /** Called when the run completes. */
  onFinish?: (result: RunResult) => void
  /** Called if the run fails. */
  onError?: (error: Error) => void
}

export interface SessionOptions {
  /** Optional title for the session. */
  title?: string
  /** Session idle timeout in seconds. Defaults to 30 days. */
  idleTimeout?: number
}

// ==================== Results ====================

export interface RunResult {
  /** The full text response from the agent. */
  text: string
  /** Tool calls made during the run. */
  toolCalls: ToolCall[]
  /** Why the run finished. */
  finishReason: "completed" | "failed" | "cancelled"
  /** Run duration in milliseconds. */
  duration: number
  /** Whether the agent hit its maximum turn limit. */
  maxTurnsReached: boolean
}

export interface ToolCall {
  /** Name of the tool that was called. */
  name: string
  /** Input passed to the tool. */
  input: unknown
  /** Tool execution duration in milliseconds. */
  duration: number
}

// ==================== Stream Events ====================

export interface TextEvent {
  type: "text"
  content: string
}

export interface ToolStartEvent {
  type: "tool-start"
  name: string
  input: unknown
}

export interface ToolEndEvent {
  type: "tool-end"
  duration: number
}

export interface RunCompletedEvent {
  type: "run-completed"
  duration: number
  maxTurnsReached: boolean
}

export interface RunFailedEvent {
  type: "run-failed"
  error: string
}

export type StreamEvent =
  | TextEvent
  | ToolStartEvent
  | ToolEndEvent
  | RunCompletedEvent
  | RunFailedEvent

// ==================== Agent ====================

export interface Agent {
  id: string
  name: string
  command: string | null
  depsStatus: string
  depsError: string | null
  requiredSecrets: string[]
  environmentKeys: string[]
  createdAt: string
  updatedAt: string
}

// ==================== Session ====================

export interface SessionInfo {
  id: string
  agentId: string
  agentName?: string
  status: string
  title?: string
  messageCount: number
  createdAt: string
}

// ==================== Internal API types ====================

/** @internal */
export interface APIAgentResponse {
  id: string
  name: string
  command: string | null
  environment_keys: string[]
  required_secrets: string[]
  deps_status: string
  deps_error: string | null
  created_at: string
  updated_at: string
}

/** @internal */
export interface APISessionResponse {
  id: string
  agent_id: string
  agent_name?: string
  status: string
  title?: string
  message_count: number
  created_at: string
}

/** @internal */
export type APIRunEvent =
  | { type: "message.delta"; data: { content?: string } }
  | { type: "tool.start"; data: { tool?: string; input?: unknown } }
  | { type: "tool.end"; data: { duration_ms?: number } }
  | {
      type: "run.completed"
      data: {
        duration_ms?: number
        max_turns_reached?: boolean
        max_turns_message?: string
      }
    }
  | { type: "run.failed"; data: { error?: { message?: string } } }
  | { type: "run.cancelled"; data: Record<string, unknown> }
  | { type: "status"; data: Record<string, unknown> }
  | { type: "run.started"; data: Record<string, unknown> }
  | { type: "heartbeat"; data: Record<string, unknown> }
