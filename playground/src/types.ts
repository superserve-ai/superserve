export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: { name: string; input: unknown; duration: number }[]
  createdAt: string // ISO string
}

export interface ChatSession {
  id: string | null // server session ID, null until first message sent
  localId: string // client-side ID
  agentName: string
  title: string
  messages: ChatMessage[]
  createdAt: string // ISO string
  updatedAt: string // ISO string
  isServerSession: boolean
}

export type ChatStatus = "ready" | "streaming" | "error" | "creating-session"
