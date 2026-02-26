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
    <div className="flex h-full flex-col bg-neutral-50 text-sm leading-relaxed text-neutral-900">
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

      {/* Footer */}
      {session && (
        <footer className="sticky bottom-0 z-10 border-t border-neutral-200 bg-white">
          <div className="mx-auto max-w-3xl px-4 py-3 md:px-6">
            <MessageInput status={status} onSend={onSend} onStop={onStop} />
          </div>
        </footer>
      )}
    </div>
  )
}
