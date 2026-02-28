import type { ChatMessage } from "../types"
import MessageBubble from "./MessageBubble"

interface MessageListProps {
  messages: ChatMessage[]
  onRetry?: () => void
}

export default function MessageList({ messages, onRetry }: MessageListProps) {
  return (
    <div className="flex flex-col gap-5">
      {messages.map((msg, i) => {
        const isLast = i === messages.length - 1
        const showRetry = isLast && msg.role === "assistant" ? onRetry : undefined
        return (
          <MessageBubble key={msg.id} message={msg} onRetry={showRetry} />
        )
      })}
    </div>
  )
}
