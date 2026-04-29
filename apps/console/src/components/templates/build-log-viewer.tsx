"use client"

import { ArrowDownIcon } from "@phosphor-icons/react"
import { cn } from "@superserve/ui"
import { useEffect, useRef, useState } from "react"
import type { BuildLogEvent } from "@/lib/api/types"

interface LogLine {
  ts: string
  stream: BuildLogEvent["stream"]
  text: string
}

const MAX_LINES = 10_000

function timeSlice(ts: string): string {
  // Accepts ISO timestamps; shows HH:mm:ss in local time.
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(11, 19)
  return d.toLocaleTimeString([], { hour12: false })
}

export function BuildLogViewer({
  templateId,
  buildId,
  className,
}: {
  templateId: string
  buildId: string
  className?: string
}) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [finalStatus, setFinalStatus] = useState<
    BuildLogEvent["status"] | null
  >(null)
  const [connError, setConnError] = useState<string | null>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // `attempt` is listed so explicit Reconnect clicks trigger a reconnect.
    void attempt
    setLines([])
    setFinalStatus(null)
    setConnError(null)

    const url = `/api/templates/${templateId}/builds/${buildId}/logs`
    const es = new EventSource(url)

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as BuildLogEvent
        if (data.finished) {
          setFinalStatus(data.status ?? null)
          es.close()
          return
        }
        setLines((prev) => {
          const next = prev.concat({
            ts: data.timestamp,
            stream: data.stream,
            text: data.text,
          })
          if (next.length > MAX_LINES) {
            return next.slice(next.length - MAX_LINES)
          }
          return next
        })
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConnError("Connection lost")
      }
    }

    return () => {
      es.close()
    }
  }, [templateId, buildId, attempt])

  // Auto-scroll whenever new lines arrive or the follow mode toggles back on.
  // `lineCount` is intentionally read from state rather than a ref so the
  // effect re-runs on each append.
  const lineCount = lines.length
  useEffect(() => {
    void lineCount
    if (autoFollow && bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: "end" })
    }
  }, [lineCount, autoFollow])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoFollow(distanceFromBottom < 24)
  }

  const jumpToLatest = () => {
    setAutoFollow(true)
    bottomRef.current?.scrollIntoView({ block: "end" })
  }

  return (
    <div
      className={cn(
        "relative border border-dashed border-border bg-background",
        className,
      )}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[480px] min-h-[160px] overflow-auto p-4 font-mono text-xs"
      >
        {lines.length === 0 && !connError && !finalStatus && (
          <div className="text-muted">Waiting for log output…</div>
        )}
        {lines.map((l, i) => (
          <div key={i} className="flex gap-3 whitespace-pre-wrap break-words">
            <span className="shrink-0 text-muted/50">{timeSlice(l.ts)}</span>
            <span
              className={cn(
                l.stream === "stderr" && "text-destructive",
                l.stream === "system" && "italic text-muted",
                l.stream === "stdout" && "text-foreground/90",
              )}
            >
              {l.text.replace(/\n$/, "")}
            </span>
          </div>
        ))}

        {finalStatus && (
          <div
            className={cn(
              "mt-3 inline-block border border-dashed px-2 py-1 font-mono text-xs uppercase",
              finalStatus === "ready" && "border-success/40 text-success",
              finalStatus === "failed" &&
                "border-destructive/40 text-destructive",
              finalStatus === "cancelled" && "border-muted/40 text-muted",
            )}
          >
            Build {finalStatus}
          </div>
        )}

        {connError && !finalStatus && (
          <div className="mt-3 flex items-center gap-3 border border-dashed border-destructive p-2 font-mono text-xs text-destructive">
            <span>{connError}</span>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="cursor-pointer underline"
            >
              Reconnect
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!autoFollow && !finalStatus && lines.length > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 right-3 flex cursor-pointer items-center gap-1 border border-dashed border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase text-muted hover:text-foreground"
        >
          <ArrowDownIcon className="size-3" weight="light" />
          Jump to latest
        </button>
      )}
    </div>
  )
}
