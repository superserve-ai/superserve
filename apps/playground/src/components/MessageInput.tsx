import { useState } from "react"
import { Button, Input } from "@superserve/ui"
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
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <Input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Send a message..."
        disabled={isStreaming}
        wrapperClassName="flex-1"
      />
      {isStreaming ? (
        <Button type="button" variant="outline" onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button type="submit" disabled={!input.trim()}>
          Send
        </Button>
      )}
    </form>
  )
}
