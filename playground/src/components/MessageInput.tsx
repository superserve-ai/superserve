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
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Send a message..."
        disabled={isStreaming}
        className="flex-1 border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none disabled:opacity-50"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="cursor-pointer border border-neutral-200 bg-white px-4 py-2.5 text-[13px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!input.trim()}
          className="cursor-pointer bg-neutral-900 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-30"
        >
          Send
        </button>
      )}
    </form>
  )
}
