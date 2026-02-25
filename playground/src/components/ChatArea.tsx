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
  const statusLabel =
    status === "streaming"
      ? "STREAMING"
      : status === "creating-session"
        ? "CONNECTING"
        : status === "error"
          ? "ERROR"
          : "READY"

  const statusDotColor =
    status === "streaming" || status === "creating-session"
      ? "bg-neutral-900"
      : status === "error"
        ? "bg-red-600"
        : "bg-neutral-400"

  const statusTextColor =
    status === "streaming" || status === "creating-session"
      ? "text-neutral-900"
      : status === "error"
        ? "text-red-600"
        : "text-neutral-400"

  return (
    <div className="flex h-full flex-col font-mono text-[13px] leading-relaxed text-neutral-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white">
        <div className="flex h-13 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleSidebar}
              className="cursor-pointer rounded p-1 transition-colors hover:bg-neutral-100 md:hidden"
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
              className="hidden cursor-pointer rounded p-1 transition-colors hover:bg-neutral-100 md:block"
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
            <div className="flex items-center gap-1.5">
              <span className="font-semibold tracking-tight">superserve</span>
              <span className="text-neutral-300">/</span>
              <span className="text-neutral-500">{agentName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className={`size-1.5 rounded-full ${statusDotColor}`} />
            <span className={`text-xs ${statusTextColor}`}>{statusLabel}</span>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 pb-8 md:px-6">
          {!session || session.messages.length === 0 ? (
            <EmptyState hasSession={session !== null} />
          ) : (
            <MessageList messages={session.messages} />
          )}
        </div>
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
