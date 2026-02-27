import type { SessionInfo } from "./types"

/**
 * Session metadata and statistics
 */
export interface SessionMetadata {
  id: string
  agentName?: string
  title?: string
  createdAt: Date
  endedAt?: Date
  messageCount: number
  duration?: number // in milliseconds
  status: "active" | "completed" | "ended"
}

/**
 * Session export format
 */
export interface SessionExport {
  version: "1.0"
  metadata: SessionMetadata
  messages: Array<{
    role: "user" | "assistant"
    content: string
    timestamp: Date
  }>
  exportedAt: Date
}

/**
 * Session search options
 */
export interface SessionSearchOptions {
  agentName?: string
  title?: string
  createdAfter?: Date
  createdBefore?: Date
  minMessages?: number
  status?: "active" | "completed" | "ended"
}

/**
 * Session storage (in-memory)
 */
export class SessionStore {
  private sessions = new Map<string, SessionMetadata>()
  private messages = new Map<string, Array<{ role: string; content: string; timestamp: Date }>>()

  /**
   * Add a new session to the store
   */
  addSession(info: SessionInfo): void {
    const metadata: SessionMetadata = {
      id: info.id,
      agentName: info.agentName,
      title: info.title,
      createdAt: new Date(info.createdAt),
      messageCount: info.messageCount,
      status: info.status as "active" | "completed" | "ended",
    }
    this.sessions.set(info.id, metadata)
    this.messages.set(info.id, [])
  }

  /**
   * Update session metadata
   */
  updateSession(id: string, updates: Partial<SessionMetadata>): void {
    const existing = this.sessions.get(id)
    if (existing) {
      this.sessions.set(id, { ...existing, ...updates })
    }
  }

  /**
   * Add a message to a session
   */
  addMessage(
    sessionId: string,
    role: string,
    content: string,
  ): void {
    const messages = this.messages.get(sessionId) ?? []
    messages.push({
      role,
      content,
      timestamp: new Date(),
    })
    this.messages.set(sessionId, messages)
  }

  /**
   * Get session metadata
   */
  getSession(id: string): SessionMetadata | undefined {
    return this.sessions.get(id)
  }

  /**
   * Get all sessions
   */
  getAllSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Search sessions
   */
  searchSessions(options: SessionSearchOptions): SessionMetadata[] {
    const results = Array.from(this.sessions.values())

    return results.filter((session) => {
      if (options.agentName && session.agentName !== options.agentName) {
        return false
      }
      if (options.title && !session.title?.includes(options.title)) {
        return false
      }
      if (options.createdAfter && session.createdAt < options.createdAfter) {
        return false
      }
      if (options.createdBefore && session.createdAt > options.createdBefore) {
        return false
      }
      if (options.minMessages && session.messageCount < options.minMessages) {
        return false
      }
      if (options.status && session.status !== options.status) {
        return false
      }
      return true
    })
  }

  /**
   * End a session (mark as completed)
   */
  endSession(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.status = "ended"
      session.endedAt = new Date()
      if (session.createdAt) {
        session.duration = session.endedAt.getTime() - session.createdAt.getTime()
      }
    }
  }

  /**
   * Export a session to JSON
   */
  exportSessionJSON(id: string): SessionExport | null {
    const metadata = this.sessions.get(id)
    const messages = this.messages.get(id) ?? []

    if (!metadata) return null

    return {
      version: "1.0",
      metadata,
      messages: messages.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
        timestamp: msg.timestamp,
      })),
      exportedAt: new Date(),
    }
  }

  /**
   * Export a session to Markdown
   */
  exportSessionMarkdown(id: string): string | null {
    const session = this.sessions.get(id)
    const messages = this.messages.get(id) ?? []

    if (!session) return null

    let markdown = `# Session Export\n\n`
    markdown += `**Agent:** ${session.agentName || "Unknown"}\n\n`
    markdown += `**Title:** ${session.title || "Untitled"}\n\n`
    markdown += `**Created:** ${session.createdAt.toISOString()}\n\n`
    markdown += `**Messages:** ${session.messageCount}\n\n`
    markdown += `**Status:** ${session.status}\n\n`

    if (session.duration) {
      markdown += `**Duration:** ${formatDuration(session.duration)}\n\n`
    }

    markdown += `---\n\n## Conversation\n\n`

    for (const msg of messages) {
      const role = msg.role === "user" ? "👤 User" : "🤖 Assistant"
      markdown += `### ${role}\n\n`
      markdown += `${msg.content}\n\n`
      markdown += `*${msg.timestamp.toLocaleTimeString()}*\n\n`
    }

    return markdown
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.sessions.clear()
    this.messages.clear()
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSessions: number
    activeSessions: number
    completedSessions: number
    totalMessages: number
    averageMessagesPerSession: number
  } {
    const sessions = Array.from(this.sessions.values())
    const totalMessages = Array.from(this.messages.values()).reduce(
      (sum, msgs) => sum + msgs.length,
      0,
    )

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.status === "active").length,
      completedSessions: sessions.filter((s) => s.status === "ended").length,
      totalMessages,
      averageMessagesPerSession:
        sessions.length > 0 ? Math.round(totalMessages / sessions.length) : 0,
    }
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

/**
 * Lifecycle manager for automatic session cleanup
 */
export class SessionLifecycleManager {
  private timeouts = new Map<string, NodeJS.Timeout>()
  private defaultIdleTimeoutMs: number

  constructor(defaultIdleTimeoutMs: number = 30 * 60 * 1000) {
    // 30 minutes default
    this.defaultIdleTimeoutMs = defaultIdleTimeoutMs
  }

  /**
   * Mark a session for auto-cleanup
   */
  markForCleanup(
    sessionId: string,
    callback: () => void,
    timeoutMs?: number,
  ): void {
    // Clear existing timeout if any
    const existing = this.timeouts.get(sessionId)
    if (existing) {
      clearTimeout(existing)
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      callback()
      this.timeouts.delete(sessionId)
    }, timeoutMs ?? this.defaultIdleTimeoutMs)

    this.timeouts.set(sessionId, timeout)
  }

  /**
   * Cancel cleanup for a session
   */
  cancelCleanup(sessionId: string): void {
    const timeout = this.timeouts.get(sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.timeouts.delete(sessionId)
    }
  }

  /**
   * Clear all pending cleanups
   */
  clearAll(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout)
    }
    this.timeouts.clear()
  }
}
