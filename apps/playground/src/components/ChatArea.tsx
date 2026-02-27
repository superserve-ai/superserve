import { useEffect, useRef, useState, useCallback } from "react"
import type { ChatSession, ChatStatus } from "../types"
import EmptyState from "./EmptyState"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"

interface ChatAreaProps {
  session: ChatSession | null
  status: ChatStatus
  agentName?: string
  onSend: (message: string) => void
  onStop: () => void
  onRetry?: () => void
}

export default function ChatArea({
  session,
  status,
  agentName,
  onSend,
  onStop,
  onRetry,
}: ChatAreaProps) {
  const mainRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const isNearBottom = useCallback(() => {
    const el = mainRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }, [])

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  const handleScroll = useCallback(() => {
    setShowScrollBtn(!isNearBottom())
  }, [isNearBottom])

  useEffect(() => {
    if (isNearBottom()) {
      endRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [session?.messages, isNearBottom])

  return (
    <div className="flex h-full flex-col bg-background text-sm leading-relaxed text-foreground">
      {/* Messages */}
      <main ref={mainRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {!session || session.messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              hasSession={session !== null}
              agentName={agentName}
              onSend={session ? onSend : undefined}
            />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6 pb-8 md:px-6">
            <MessageList messages={session.messages} onRetry={onRetry} />
            <div ref={endRef} />
          </div>
        )}
      </main>

      {/* Scroll to bottom */}
      {showScrollBtn && (
        <div className="flex justify-center py-1">
          <button
            type="button"
            onClick={scrollToBottom}
            className="mx-auto flex cursor-pointer items-center gap-1 border border-dashed border-border bg-surface px-3 py-1.5 text-[11px] text-muted shadow-sm transition-colors hover:text-foreground"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M6 2v8M2.5 6.5L6 10l3.5-3.5" />
            </svg>
            Scroll to bottom
          </button>
        </div>
      )}

      {/* Input */}
      {session && (
        <div className="pointer-events-none sticky bottom-0 z-10 pb-4">
          <div className="pointer-events-auto mx-auto max-w-3xl px-4 md:px-6">
            <MessageInput
              key={session.localId}
              status={status}
              onSend={onSend}
              onStop={onStop}
            />
          </div>
        </div>
      )}
    </div>
  )
}
