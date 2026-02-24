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
        className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 font-mono text-[13px] text-neutral-900 transition-colors focus:border-neutral-900 focus:outline-none disabled:opacity-50"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="cursor-pointer rounded-md border border-neutral-200 bg-white px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-900 transition-opacity hover:opacity-70"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!input.trim()}
          className="cursor-pointer rounded-md bg-neutral-900 px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-white transition-opacity hover:opacity-80 disabled:opacity-30"
        >
          Send
        </button>
      )}
    </form>
  )
}
