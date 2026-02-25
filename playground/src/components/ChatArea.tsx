import type { ChatSession, ChatStatus } from "../types"
import EmptyState from "./EmptyState"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"

interface ChatAreaProps {
  agentName: string
  session: ChatSession | null
  status: ChatStatus
  onSend: (message: string) => void
  onStop: () => void
  onToggleSidebar: () => void
  onBack: () => void
}

export default function ChatArea({
  agentName,
  session,
  status,
  onSend,
  onStop,
  onToggleSidebar,
  onBack,
}: ChatAreaProps) {
  const isActive = status === "streaming" || status === "creating-session"

  const statusLabel = isActive
    ? "Streaming"
    : status === "error"
      ? "Error"
      : "Ready"

  return (
    <div className="flex h-full flex-col bg-neutral-50 text-sm leading-relaxed text-neutral-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white">
        <div className="flex h-14 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleSidebar}
              className="cursor-pointer p-1.5 text-neutral-500 transition-colors hover:text-neutral-700 md:hidden"
              aria-label="Toggle sidebar"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="3" y1="4.5" x2="15" y2="4.5" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="13.5" x2="15" y2="13.5" />
              </svg>
            </button>
            <button
              onClick={onBack}
              className="hidden cursor-pointer p-1.5 text-neutral-500 transition-colors hover:text-neutral-700 md:block"
              aria-label="Back to agent picker"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4L6 9l5 5" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <div className="flex size-5 items-center justify-center bg-neutral-900">
                <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M7 1L12.5 4.5V9.5L7 13L1.5 9.5V4.5L7 1Z"
                    stroke="white"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="font-medium text-neutral-900">{agentName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`size-1.5 rounded-full ${
                isActive
                  ? "animate-pulse-dot bg-neutral-900"
                  : status === "error"
                    ? "bg-neutral-400"
                    : "bg-neutral-300"
              }`}
            />
            <span
              className={`text-xs ${
                isActive
                  ? "text-neutral-900"
                  : status === "error"
                    ? "text-neutral-500"
                    : "text-neutral-400"
              }`}
            >
              {statusLabel}
            </span>
          </div>
        </div>
      </header>

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
