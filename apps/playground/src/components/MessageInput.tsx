import { useState } from "react"
import type { ChatStatus } from "../types"

interface MessageInputProps {
  status: ChatStatus
  onSend: (message: string) => void
  onStop: () => void
}

export default function MessageInput({
  status,
  onSend,
  onStop,
}: MessageInputProps) {
  const [input, setInput] = useState("")
  const isStreaming = status === "streaming" || status === "creating-session"

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput("")
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center border border-dashed border-border bg-surface shadow-sm transition-colors focus-within:border-border-focus"
    >
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Send a message..."
        disabled={isStreaming}
        className="h-10 flex-1 bg-transparent px-4 text-sm text-foreground placeholder:text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="cursor-pointer px-4 text-sm text-muted transition-colors hover:text-foreground"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!input.trim()}
          className="m-1 cursor-pointer bg-primary-bg px-5 py-1.5 font-mono text-xs uppercase tracking-wider text-primary transition-colors hover:bg-primary-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      )}
    </form>
  )
}
