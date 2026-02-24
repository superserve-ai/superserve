import type { ChatSession } from "../types"
import { relativeTime } from "../utils"

interface SidebarProps {
  sessions: ChatSession[]
  activeLocalId: string | null
  onNewChat: () => void
  onSelectSession: (localId: string) => void
  onDeleteSession: (localId: string) => void
  onClose: () => void
}

export default function Sidebar({
  sessions,
  activeLocalId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onClose,
}: SidebarProps) {
  // Sort by updatedAt descending
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )

  return (
    <div className="flex h-full flex-col border-r border-neutral-200 bg-white font-mono text-[13px]">
      {/* Header */}
      <div className="flex h-13 items-center justify-between border-b border-neutral-200 px-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Chats
        </span>
        <button
          onClick={onClose}
          className="cursor-pointer rounded p-1 transition-colors hover:bg-neutral-100 md:hidden"
          aria-label="Close sidebar"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      {/* New Chat button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full cursor-pointer rounded-md bg-neutral-900 px-3 py-2 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-white transition-opacity hover:opacity-80"
        >
          New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((session) => (
          <div
            key={session.localId}
            onClick={() => onSelectSession(session.localId)}
            className={`group flex cursor-pointer items-start justify-between px-4 py-3 transition-colors hover:bg-neutral-50 ${
              session.localId === activeLocalId ? "bg-neutral-100" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-neutral-900">
                {session.title}
              </p>
              <p className="mt-0.5 text-[11px] text-neutral-400">
                {relativeTime(session.updatedAt)}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDeleteSession(session.localId)
              }}
              className="ml-2 mt-0.5 shrink-0 cursor-pointer rounded p-0.5 text-neutral-300 opacity-0 transition-opacity hover:text-neutral-600 group-hover:opacity-100"
              aria-label="Delete session"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
                <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
              </svg>
            </button>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="px-4 py-6 text-center text-[11px] text-neutral-400">
            No conversations yet
          </p>
        )}
      </div>
    </div>
  )
}
