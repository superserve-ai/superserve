import Markdown from "react-markdown"
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
    <div className="flex gap-3">
      {/* Avatar */}
      <div
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-neutral-900" : "bg-neutral-200"
        }`}
      >
        {isUser ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="white"
            strokeWidth="1.2"
            strokeLinecap="round"
          >
            <circle cx="6" cy="4" r="2.5" />
            <path d="M1.5 11c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 1L12.5 4.5V9.5L7 13L1.5 9.5V4.5L7 1Z"
              stroke="#525252"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <circle cx="7" cy="7" r="1.5" fill="#525252" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-neutral-500">
          {isUser ? "You" : "Agent"}
        </span>
        <div
          className={`mt-1 break-words px-3.5 py-2.5 leading-relaxed ${
            isUser
              ? "bg-neutral-900 text-white"
              : "border border-neutral-200 bg-white text-neutral-800"
          }`}
        >
          {isEmpty ? (
            <div className="flex items-center gap-1.5 py-0.5">
              <span className="size-1.5 animate-pulse rounded-full bg-neutral-400" />
              <span className="size-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:300ms]" />
            </div>
          ) : !isUser ? (
            <div className="markdown-content">
              <Markdown>{message.content}</Markdown>
            </div>
          ) : (
            message.content
          )}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5 border-t border-neutral-100 pt-2">
              {message.toolCalls.map((tc, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-400"
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
                  <span className="text-neutral-300">
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
