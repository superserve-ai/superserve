import Markdown from "react-markdown"
import { Avatar } from "@superserve/ui"
import type { ChatMessage } from "../types"

interface MessageBubbleProps {
  message: ChatMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const isEmpty =
    !isUser &&
    !message.content &&
    (!message.toolCalls || message.toolCalls.length === 0)

  return (
    <div className="flex items-start gap-3">
      <div>
        <Avatar fallback={isUser ? "Y" : "A"} size="xs" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div
          className={`wrap-break-word px-3.5 py-2.5 leading-relaxed ${
            isUser
              ? "bg-primary text-surface"
              : "border border-border bg-surface text-foreground"
          }`}
        >
          {isEmpty ? (
            <div className="flex items-center gap-1.5 py-0.5">
              <span className="size-1.5 animate-pulse rounded-full bg-muted" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
            </div>
          ) : !isUser ? (
            <div className="markdown-content">
              <Markdown>{message.content}</Markdown>
            </div>
          ) : (
            message.content
          )}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5 border-t border-border/50 pt-2">
              {message.toolCalls.map((tc, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 font-mono text-[11px] text-muted"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  >
                    <path d="M6 1L9 3.5 6 6" />
                    <path d="M4 4L1 6.5 4 9" />
                  </svg>
                  {tc.name}
                  <span className="text-ink-faint">
                    {tc.duration > 0 ? `${tc.duration}ms` : "..."}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
