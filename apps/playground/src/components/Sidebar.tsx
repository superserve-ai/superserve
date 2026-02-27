import { Button } from "@superserve/ui"
import type { ChatSession } from "../types"
import { relativeTime } from "../utils"

interface SidebarProps {
  sessions: ChatSession[]
  activeLocalId: string | null
  onNewChat: () => void
  onSelectSession: (localId: string) => void
  onDeleteSession: (localId: string) => void
}

export default function Sidebar({
  sessions,
  activeLocalId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: SidebarProps) {
  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )

  return (
    <div className="flex h-full flex-col border-r border-dashed border-border bg-background text-sm">
      {/* New Chat button */}
      <div className="p-3">
        <Button onClick={onNewChat} className="flex w-full">
          <svg
            className="size-4"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <line x1="7" y1="3" x2="7" y2="11" />
            <line x1="3" y1="7" x2="11" y2="7" />
          </svg>
          New Chat
        </Button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((session) => {
          const isActive = session.localId === activeLocalId
          return (
            <div
              key={session.localId}
              onClick={() => onSelectSession(session.localId)}
              className={`group flex cursor-pointer items-start justify-between px-4 py-2.5 transition-colors ${
                isActive
                  ? "bg-surface-hover"
                  : "hover:bg-surface-hover"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-[13px] ${isActive ? "font-medium text-foreground" : "text-ink"}`}
                >
                  {session.title}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {relativeTime(session.updatedAt)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteSession(session.localId)
                }}
                className="ml-2 mt-0.5 shrink-0 cursor-pointer p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-ink-light group-hover:opacity-100"
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
          )
        })}
        {sorted.length === 0 && (
          <p className="px-4 py-8 text-center text-[12px] text-muted">
            No conversations yet
          </p>
        )}
      </div>
    </div>
  )
}
