import Markdown from "react-markdown"
import type { ChatMessage } from "../types"

interface MessageBubbleProps {
  message: ChatMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const isEmpty =
    !isUser && !message.content && (!message.toolCalls || message.toolCalls.length === 0)

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`text-[11px] font-semibold uppercase tracking-widest ${
          isUser ? "text-neutral-900" : "text-neutral-500"
        }`}
      >
        {isUser ? "you" : "agent"}
      </span>
      <div
        className={`wrap-break-word rounded-md px-3.5 py-2.5 leading-relaxed ${
          isUser
            ? "rounded-bl-sm bg-neutral-900 text-white"
            : "rounded-bl-sm border border-neutral-200 bg-neutral-50 text-neutral-900"
        }`}
      >
        {isEmpty ? (
          <div className="flex items-center gap-1">
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
          <div className="mt-2.5 flex flex-col gap-0.5 border-t border-black/8 pt-2">
            {message.toolCalls.map((tc, i) => (
              <div key={i} className="text-[11px] text-neutral-400">
                {tc.name}{" "}
                <span className="text-neutral-300">
                  {tc.duration > 0 ? `${tc.duration}ms` : "..."}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
