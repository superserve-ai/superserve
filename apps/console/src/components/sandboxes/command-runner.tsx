// src/components/sandboxes/command-runner.tsx
"use client"

import { StopIcon } from "@phosphor-icons/react"
import { Button, cn } from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useEffect, useRef } from "react"
import { useCommandHistory } from "@/hooks/use-command-history"
import { type OutputLine, useExecStream } from "@/hooks/use-exec-stream"
import { TERMINAL_EVENTS } from "@/lib/posthog/events"

export interface CommandRunnerHandle {
  clear: () => void
}

interface CommandRunnerProps {
  sandboxId: string
  handleRef?: React.MutableRefObject<CommandRunnerHandle | null>
}

function OutputBlock({ line }: { line: OutputLine }) {
  return (
    <span
      className={cn(
        "block whitespace-pre-wrap break-all font-mono text-xs leading-relaxed",
        line.type === "stdout" && "text-foreground/80",
        line.type === "stderr" && "text-yellow-400/80",
        line.type === "error" && "text-destructive",
        line.type === "exit" && "text-muted",
        line.type === "command" && "text-foreground mt-2 first:mt-0",
      )}
    >
      {line.text}
    </span>
  )
}

export function CommandRunner({ sandboxId, handleRef }: CommandRunnerProps) {
  const { status, output, execute, abort, clear } = useExecStream(sandboxId)
  const { push, navigate, reset } = useCommandHistory(sandboxId)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isRunning = status === "running"
  const posthog = usePostHog()

  // Expose clear to parent
  useEffect(() => {
    if (handleRef) handleRef.current = { clear }
  }, [handleRef, clear])

  // Auto-scroll to bottom
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on output/status changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [output, isRunning])

  // Focus input on mount and when command finishes
  useEffect(() => {
    if (!isRunning) inputRef.current?.focus()
  }, [isRunning])

  const handleSubmit = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || isRunning) return
    push(trimmed)
    posthog.capture(TERMINAL_EVENTS.COMMAND_EXECUTED, {
      sandbox_id: sandboxId,
    })
    reset()
    execute(trimmed)
    if (inputRef.current) inputRef.current.value = ""
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = inputRef.current
    if (!input) return

    if (e.key === "Enter") {
      e.preventDefault()
      handleSubmit(input.value)
      return
    }

    if (e.key === "c" && e.ctrlKey && isRunning) {
      e.preventDefault()
      abort()
      return
    }

    if (e.key === "ArrowUp") {
      e.preventDefault()
      const prev = navigate("up", input.value)
      if (prev !== null) input.value = prev
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      const next = navigate("down", input.value)
      if (next !== null) input.value = next
      return
    }
  }

  const focusInput = () => {
    if (!isRunning) inputRef.current?.focus()
  }

  return (
    <div
      ref={scrollRef}
      role="log"
      className="flex-1 overflow-y-auto bg-background px-4 py-3 cursor-text"
      onClick={focusInput}
      onKeyDown={() => inputRef.current?.focus()}
    >
      {/* Output */}
      {output.map((line, i) => (
        <OutputBlock key={i} line={line} />
      ))}
      {isRunning && (
        <span className="inline-block size-2 animate-pulse bg-foreground/60" />
      )}

      {/* Inline input */}
      {!isRunning && (
        <div className="flex items-center gap-2 mt-2 first:mt-0">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              status === "idle" && "bg-muted",
              status === "done" && "bg-emerald-400",
              status === "error" && "bg-destructive",
            )}
          />
          <span className="font-mono text-xs text-muted select-none">$</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Enter a command"
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder:text-muted outline-none"
            aria-label="Command input"
          />
        </div>
      )}
      {isRunning && (
        <div className="flex items-center gap-2 mt-1">
          <span className="size-1.5 shrink-0 rounded-full bg-yellow-400 animate-pulse" />
          <span className="font-mono text-xs text-muted">Running...</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation()
              posthog.capture(TERMINAL_EVENTS.COMMAND_ABORTED, {
                sandbox_id: sandboxId,
              })
              abort()
            }}
            aria-label="Stop command"
          >
            <StopIcon className="size-3.5" weight="light" />
          </Button>
        </div>
      )}
    </div>
  )
}
