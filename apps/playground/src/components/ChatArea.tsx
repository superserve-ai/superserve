import type { ChatSession, ChatStatus } from "../types"
import EmptyState from "./EmptyState"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"

interface ChatAreaProps {
  session: ChatSession | null
  status: ChatStatus
  onSend: (message: string) => void
  onStop: () => void
}

export default function ChatArea({
  session,
  status,
  onSend,
  onStop,
}: ChatAreaProps) {
  return (
    <div className="flex h-full flex-col bg-background text-sm leading-relaxed text-foreground">
      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        {!session || session.messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState hasSession={session !== null} />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6 pb-8 md:px-6">
            <MessageList messages={session.messages} />
          </div>
        )}
      </main>

      {/* Input */}
      {session && (
        <div className="pointer-events-none sticky bottom-0 z-10 pb-4">
          <div className="pointer-events-auto mx-auto max-w-3xl px-4 md:px-6">
            <MessageInput status={status} onSend={onSend} onStop={onStop} />
          </div>
        </div>
      )}
    </div>
  )
}
