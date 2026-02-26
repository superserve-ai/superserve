import { useRef, useCallback, useMemo } from "react"
import { Superserve } from "@superserve/sdk"
import type { AgentStream } from "@superserve/sdk"
import { useLocalStorage } from "./useLocalStorage"
import { generateId } from "../utils"
import type { ChatSession, ChatMessage, ChatStatus } from "../types"

interface UseSuperserveChatOptions {
  agentId: string
  agentName: string
  apiKey: string
  baseUrl?: string
}

export function useSuperserveChat(options: UseSuperserveChatOptions) {
  const { agentId, agentName, apiKey, baseUrl } = options

  const sessionsKey = `superserve-chat-sessions-${agentId}`
  const activeKey = `superserve-chat-active-session-${agentId}`

  const [sessions, setSessions] = useLocalStorage<ChatSession[]>(
    sessionsKey,
    [],
  )
  const [activeLocalId, setActiveLocalId] = useLocalStorage<string | null>(
    activeKey,
    null,
  )

  const clientRef = useRef<Superserve | null>(null)
  const streamRef = useRef<AgentStream | null>(null)
  const streamingSessionRef = useRef<string | null>(null)
  const errorSessionRef = useRef<string | null>(null)

  // Lazily create the Superserve client
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new Superserve({
        apiKey,
        baseUrl,
      })
    }
    return clientRef.current
  }, [apiKey, baseUrl])

  // Derive active session
  const activeSession = useMemo(
    () => sessions.find((s) => s.localId === activeLocalId) ?? null,
    [sessions, activeLocalId],
  )

  // Derive status for the active session
  const status: ChatStatus = useMemo(() => {
    if (!activeLocalId) return "ready"
    if (streamingSessionRef.current === activeLocalId) return "streaming"
    if (errorSessionRef.current === activeLocalId) return "error"
    return "ready"
  }, [activeLocalId, sessions]) // sessions dependency forces re-derive after state updates

  // Create a new local session
  const createSession = useCallback(() => {
    const localId = generateId()
    const now = new Date().toISOString()
    const session: ChatSession = {
      id: null,
      localId,
      agentName,
      title: "New Chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
      isServerSession: false,
    }
    setSessions((prev) => [session, ...prev])
    setActiveLocalId(localId)
    return localId
  }, [agentName, setSessions, setActiveLocalId])

  // Switch to a session
  const switchSession = useCallback(
    (localId: string) => {
      // Abort current stream if switching away from a streaming session
      if (streamRef.current && streamingSessionRef.current !== localId) {
        streamRef.current.abort()
        streamRef.current = null
        streamingSessionRef.current = null
      }
      setActiveLocalId(localId)
    },
    [setActiveLocalId],
  )

  // Delete a session
  const deleteSession = useCallback(
    (localId: string) => {
      // Abort stream if deleting the streaming session
      if (streamRef.current && streamingSessionRef.current === localId) {
        streamRef.current.abort()
        streamRef.current = null
        streamingSessionRef.current = null
      }

      setSessions((prev) => {
        const filtered = prev.filter((s) => s.localId !== localId)
        // If we deleted the active session, switch to the most recent
        if (activeLocalId === localId) {
          setActiveLocalId(filtered.length > 0 ? filtered[0].localId : null)
        }
        return filtered
      })
    },
    [activeLocalId, setSessions, setActiveLocalId],
  )

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!activeLocalId) return

      const targetLocalId = activeLocalId

      // Abort any existing stream
      if (streamRef.current) {
        streamRef.current.abort()
        streamRef.current = null
        streamingSessionRef.current = null
      }

      // Clear error state
      errorSessionRef.current = null

      // Add user message
      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      }

      // Add assistant placeholder
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      }

      const assistantMsgId = assistantMessage.id

      setSessions((prev) =>
        prev.map((s) => {
          if (s.localId !== targetLocalId) return s
          const title =
            s.messages.length === 0
              ? content.slice(0, 50) || "New Chat"
              : s.title
          return {
            ...s,
            title,
            messages: [...s.messages, userMessage, assistantMessage],
            updatedAt: new Date().toISOString(),
          }
        }),
      )

      // Determine if we need to create a server session first
      const session = sessions.find((s) => s.localId === targetLocalId)
      let serverSessionId = session?.id ?? null
      const needsServerSession = !session?.isServerSession

      try {
        if (needsServerSession) {
          streamingSessionRef.current = targetLocalId
          // Force a re-render so status shows "creating-session"/"streaming"
          setSessions((prev) => [...prev])

          const client = getClient()
          const serverSession = await client.createSession(agentId, {
            title: content.slice(0, 50),
          })
          serverSessionId = serverSession.id

          // Update session with server ID
          setSessions((prev) =>
            prev.map((s) => {
              if (s.localId !== targetLocalId) return s
              return { ...s, id: serverSessionId, isServerSession: true }
            }),
          )
        }

        if (!serverSessionId) return

        // Start streaming
        streamingSessionRef.current = targetLocalId
        const client = getClient()
        const stream = client.stream(agentId, {
          sessionId: serverSessionId,
          message: content,
          onText: (chunk) => {
            setSessions((prev) =>
              prev.map((s) => {
                if (s.localId !== targetLocalId) return s
                return {
                  ...s,
                  messages: s.messages.map((m) => {
                    if (m.id !== assistantMsgId) return m
                    return { ...m, content: m.content + chunk }
                  }),
                  updatedAt: new Date().toISOString(),
                }
              }),
            )
          },
          onToolStart: (event) => {
            setSessions((prev) =>
              prev.map((s) => {
                if (s.localId !== targetLocalId) return s
                return {
                  ...s,
                  messages: s.messages.map((m) => {
                    if (m.id !== assistantMsgId) return m
                    const toolCalls = [...(m.toolCalls ?? []), { name: event.name, input: event.input, duration: 0 }]
                    return { ...m, toolCalls }
                  }),
                }
              }),
            )
          },
          onToolEnd: (event) => {
            setSessions((prev) =>
              prev.map((s) => {
                if (s.localId !== targetLocalId) return s
                return {
                  ...s,
                  messages: s.messages.map((m) => {
                    if (m.id !== assistantMsgId) return m
                    const toolCalls = [...(m.toolCalls ?? [])]
                    const lastTool = toolCalls[toolCalls.length - 1]
                    if (lastTool) {
                      toolCalls[toolCalls.length - 1] = { ...lastTool, duration: event.duration }
                    }
                    return { ...m, toolCalls }
                  }),
                }
              }),
            )
          },
        })

        streamRef.current = stream

        // Consume the stream
        for await (const _event of stream) {
          // Events are handled by callbacks above
        }

        // Stream completed
        streamRef.current = null
        streamingSessionRef.current = null
        // Trigger re-render for status update
        setSessions((prev) => [...prev])
      } catch (err) {
        streamRef.current = null
        streamingSessionRef.current = null
        errorSessionRef.current = targetLocalId

        // Update assistant message with error info
        const errorMessage =
          err instanceof Error ? err.message : "An error occurred"

        setSessions((prev) =>
          prev.map((s) => {
            if (s.localId !== targetLocalId) return s
            return {
              ...s,
              messages: s.messages.map((m) => {
                if (m.id !== assistantMsgId) return m
                // If assistant message is empty, show error there
                if (!m.content) {
                  return { ...m, content: `Error: ${errorMessage}` }
                }
                return m
              }),
            }
          }),
        )
      }
    },
    [activeLocalId, sessions, agentId, getClient, setSessions],
  )

  // Stop the current stream
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.abort()
      streamRef.current = null
      streamingSessionRef.current = null
      // Trigger re-render
      setSessions((prev) => [...prev])
    }
  }, [setSessions])

  return {
    sessions,
    activeSession,
    activeLocalId,
    status,
    createSession,
    switchSession,
    deleteSession,
    sendMessage,
    stopStream,
  }
}
