import type { ToolCall } from "../types"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  createdAt: Date
}

export type AgentStatus = "ready" | "streaming" | "error"

export interface UseAgentOptions {
  /** Agent name or ID to interact with. */
  agent: string
  /** API key for authentication. Can also be provided via SuperserveProvider. */
  apiKey?: string
  /** Base URL for the Superserve API. */
  baseUrl?: string
  /** Initial messages to populate the chat. */
  initialMessages?: Message[]
  /** Called when the agent finishes responding. */
  onFinish?: (message: Message) => void
  /** Called on errors. */
  onError?: (error: Error) => void
}

export interface UseAgentReturn {
  /** The list of messages in the conversation. */
  messages: Message[]
  /** Send a message to the agent. */
  sendMessage: (content: string) => void
  /** Current status of the agent interaction. */
  status: AgentStatus
  /** Whether the agent is currently streaming a response. */
  isStreaming: boolean
  /** The current error, if any. */
  error: Error | null
  /** Stop the current stream. */
  stop: () => void
  /** Clear all messages and end the session. */
  reset: () => void
}
