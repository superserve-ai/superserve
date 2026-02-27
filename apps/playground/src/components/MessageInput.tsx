import { useRef, useState } from "react"
import { Kbd } from "@superserve/ui"
import type { ChatStatus } from "../types"

interface MessageInputProps {
  status: ChatStatus
  onSend: (message: string) => void
  onStop: () => void
}

const MAX_ROWS = 6
const LINE_HEIGHT = 20 // text-sm leading-relaxed ~ 20px

export default function MessageInput({
  status,
  onSend,
  onStop,
}: MessageInputProps) {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStreaming = status === "streaming" || status === "creating-session"

  const resizeTextarea = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxHeight = LINE_HEIGHT * MAX_ROWS
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submitMessage()
  }

  const submitMessage = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput("")
    // Reset textarea height after clearing
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submitMessage()
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form
        onSubmit={handleSubmit}
        className="flex items-end border border-dashed border-border bg-surface shadow-sm transition-colors focus-within:border-border-focus"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            resizeTextarea()
          }}
          onKeyDown={handleKeyDown}
          autoFocus
          placeholder="Send a message..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none bg-transparent px-4 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="cursor-pointer px-4 pb-2.5 text-sm text-muted transition-colors hover:text-foreground"
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
      <p className="hidden text-xs text-muted md:block">
        <Kbd>Enter</Kbd> to send, <Kbd>Shift + Enter</Kbd> for new line
      </p>
    </div>
  )
}
