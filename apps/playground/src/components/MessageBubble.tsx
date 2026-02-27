import { useState } from "react"
import Markdown from "react-markdown"
import {
  Avatar,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@superserve/ui"
import type { ChatMessage } from "../types"

function CodeBlock({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const [copied, setCopied] = useState(false)

  const match = /language-(\w+)/.exec(className || "")
  const isBlock = match || (typeof children === "string" && children.includes("\n"))

  if (!isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  }

  const language = match ? match[1] : ""
  const code = String(children).replace(/\n$/, "")

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-3">
      <div className="flex items-center justify-between border border-b-0 border-dashed border-neutral-700 bg-neutral-900 px-4 py-1.5">
        <span className="font-mono text-[11px] text-neutral-500">
          {language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="font-mono text-[11px] text-neutral-500 hover:text-neutral-300"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
}

interface MessageBubbleProps {
  message: ChatMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const isEmpty =
    !isUser &&
    !message.content &&
    (!message.toolCalls || message.toolCalls.length === 0)

  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())

  const toggleTool = (i: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(i)) {
        next.delete(i)
      } else {
        next.add(i)
      }
      return next
    })
  }

  const handleCopyMessage = () => {
    if (message.content) {
      navigator.clipboard.writeText(message.content)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group flex items-start gap-3">
          <div>
            <Avatar fallback={isUser ? "Y" : "A"} size="xs" />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div
              className={`wrap-break-word px-3.5 py-2.5 leading-relaxed ${
                isUser
                  ? "bg-primary text-surface"
                  : "border border-dashed border-border bg-surface text-foreground"
              }`}
            >
              {isEmpty ? (
                <div className="flex items-center gap-1 py-0.5">
                  <span className="size-1 animate-pulse rounded-full bg-muted" />
                  <span className="size-1 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
                  <span className="size-1 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
                </div>
              ) : !isUser ? (
                <div className="markdown-content">
                  <Markdown components={{ code: CodeBlock }}>
                    {message.content}
                  </Markdown>
                </div>
              ) : (
                message.content
              )}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="mt-2 flex flex-col gap-0.5 border-t border-dashed border-border/50 pt-2">
                  {message.toolCalls.map((tc, i) => (
                    <div key={i}>
                      <button
                        type="button"
                        onClick={() => toggleTool(i)}
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
                          className={`transition-transform ${expandedTools.has(i) ? "rotate-90" : ""}`}
                        >
                          <path d="M3 1.5L7 5L3 8.5" />
                        </svg>
                        {tc.name}
                        <span className="text-ink-faint">
                          {tc.duration > 0 ? `${tc.duration}ms` : "..."}
                        </span>
                      </button>
                      {expandedTools.has(i) && (
                        <pre className="mt-1 max-h-40 overflow-auto bg-neutral-900 p-2 font-mono text-[10px] leading-relaxed text-neutral-400">
                          {JSON.stringify(tc.input, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Copy button for assistant messages */}
          {!isUser && !isEmpty && (
            <button
              type="button"
              onClick={handleCopyMessage}
              className="mt-2.5 shrink-0 cursor-pointer p-1 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="5" y="5" width="9" height="9" rx="1" />
                <path d="M2 11V2.5A.5.5 0 0 1 2.5 2H11" />
              </svg>
            </button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        {formatTime(message.createdAt)}
      </TooltipContent>
    </Tooltip>
  )
}
