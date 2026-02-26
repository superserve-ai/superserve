import { useCallback, useRef, useState } from "react"
import { Superserve } from "../client"
import { SuperserveError } from "../errors"
import { Session } from "../session"
import type { ToolCall } from "../types"
import { useSuperserveContext } from "./provider"
import type {
  AgentStatus,
  Message,
  UseAgentOptions,
  UseAgentReturn,
} from "./types"

let messageCounter = 0
function generateId(): string {
  return `msg_${Date.now()}_${++messageCounter}`
}

/**
 * React hook for building chat interfaces with Superserve agents.
 *
 * @example
 * ```tsx
 * import { useAgent } from 'superserve/react'
 *
 * function Chat() {
 *   const { messages, sendMessage, status, stop } = useAgent({
 *     agent: 'my-agent',
 *     apiKey: 'ss_...',
 *   })
 *
 *   return (
 *     <div>
 *       {messages.map(msg => (
 *         <div key={msg.id}>
 *           <strong>{msg.role}:</strong> {msg.content}
 *         </div>
 *       ))}
 *       {status === 'streaming' && <button onClick={stop}>Stop</button>}
 *     </div>
 *   )
 * }
 * ```
 */
export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const context = useSuperserveContext()
  const apiKey = options.apiKey ?? context?.apiKey
  const baseUrl = options.baseUrl ?? context?.baseUrl

  const [messages, setMessages] = useState<Message[]>(
    options.initialMessages ?? [],
  )
  const [status, setStatus] = useState<AgentStatus>("ready")
  const [error, setError] = useState<Error | null>(null)

  const clientRef = useRef<Superserve | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  // Lazily initialize client
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new Superserve({ apiKey: apiKey!, baseUrl })
    }
    return clientRef.current
  }, [apiKey, baseUrl])

  // Lazily initialize session
  const getSession = useCallback(async () => {
    if (!sessionRef.current) {
      const client = getClient()
      sessionRef.current = await client.createSession(options.agent)
    }
    return sessionRef.current
  }, [getClient, options.agent])

  const sendMessage = useCallback(
    (content: string) => {
      if (status === "streaming") return

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content,
        createdAt: new Date(),
      }

      setMessages((prev) => [...prev, userMessage])
      setStatus("streaming")
      setError(null)

      // Run the streaming in the background
      ;(async () => {
        try {
          const session = await getSession()

          let assistantText = ""
          const toolCalls: ToolCall[] = []
          let currentTool: { name: string; input: unknown } | null = null

          const assistantId = generateId()

          // Add placeholder assistant message
          setMessages((prev) => [
            ...prev,
            {
              id: assistantId,
              role: "assistant",
              content: "",
              createdAt: new Date(),
            },
          ])

          const stream = session.stream(content)
          abortRef.current = () => stream.abort()

          for await (const event of stream) {
            switch (event.type) {
              case "text":
                assistantText += event.content
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, content: assistantText }
                      : msg,
                  ),
                )
                break
              case "tool-start":
                currentTool = { name: event.name, input: event.input }
                break
              case "tool-end":
                if (currentTool) {
                  toolCalls.push({
                    ...currentTool,
                    duration: event.duration,
                  })
                  currentTool = null
                }
                break
              case "run-failed":
                setError(new Error(event.error))
                setStatus("error")
                options.onError?.(new Error(event.error))
                return
            }
          }

          // Update final message with tool calls
          const finalMessage: Message = {
            id: assistantId,
            role: "assistant",
            content: assistantText,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            createdAt: new Date(),
          }

          setMessages((prev) =>
            prev.map((msg) => (msg.id === assistantId ? finalMessage : msg)),
          )
          setStatus("ready")
          abortRef.current = null
          options.onFinish?.(finalMessage)
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e))
          setError(err)
          setStatus("error")
          abortRef.current = null
          options.onError?.(err)
        }
      })()
    },
    [status, getSession, options],
  )

  const stop = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setStatus("ready")
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null

    // End session in background
    if (sessionRef.current) {
      sessionRef.current.end().catch(() => {})
      sessionRef.current = null
    }

    setMessages(options.initialMessages ?? [])
    setStatus("ready")
    setError(null)
  }, [options.initialMessages])

  return {
    messages,
    sendMessage,
    status,
    isStreaming: status === "streaming",
    error,
    stop,
    reset,
  }
}
