"use client"

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { usePostHog } from "posthog-js/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { mintTerminalToken } from "@/lib/api/terminal"
import { TERMINAL_EVENTS } from "@/lib/posthog/events"
import "@xterm/xterm/css/xterm.css"

type Status = "connecting" | "connected" | "disconnected" | "error"

const encoder = new TextEncoder()

interface Props {
  sandboxId: string
}

export function SandboxTerminal({ sandboxId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const posthogRef = useRef(usePostHog())
  const [status, setStatus] = useState<Status>("connecting")

  // Keep posthog ref current without triggering reconnects
  const posthog = usePostHog()
  posthogRef.current = posthog

  const connectWebSocket = useCallback(
    async (term: Terminal) => {
      // Clean up previous WebSocket
      wsRef.current?.close(1000, "reconnect")
      setStatus("connecting")

      try {
        const tok = await mintTerminalToken(sandboxId)

        const ws = new WebSocket(tok.url, [
          tok.subprotocol,
          `token.${tok.token}`,
        ])
        ws.binaryType = "arraybuffer"
        wsRef.current = ws

        ws.onopen = () => {
          setStatus("connected")
          posthogRef.current.capture(TERMINAL_EVENTS.SESSION_STARTED, {
            sandbox_id: sandboxId,
          })
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          )
          term.focus()
        }

        ws.onmessage = (evt) => {
          if (typeof evt.data === "string") return
          term.write(new Uint8Array(evt.data))
        }

        ws.onerror = () => {
          term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n")
          setStatus("error")
        }

        ws.onclose = (evt) => {
          posthogRef.current.capture(TERMINAL_EVENTS.SESSION_ENDED, {
            sandbox_id: sandboxId,
            close_code: evt.code,
          })
          if (evt.code === 1000) {
            term.write("\r\n\x1b[33m[session ended]\x1b[0m\r\n")
          } else {
            term.write(`\r\n\x1b[31m[disconnected: ${evt.code}]\x1b[0m\r\n`)
          }
          setStatus("disconnected")
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        term.write(`\r\n\x1b[31m[error: ${message}]\x1b[0m\r\n`)
        setStatus("error")
      }
    },
    [sandboxId],
  )

  // Initialize terminal once on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      letterSpacing: -0.8,
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#525252",
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    termRef.current = term

    // Forward keystrokes to WebSocket
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(encoder.encode(data))
      }
    })

    // Debounced resize: refit terminal and notify server
    const ro = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        fit.fit()
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          )
        }
      }, 100)
    })
    ro.observe(container)
    roRef.current = ro

    // Start first connection
    connectWebSocket(term)

    return () => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      ro.disconnect()
      wsRef.current?.close(1000, "unmount")
      term.dispose()
      termRef.current = null
    }
  }, [connectWebSocket])

  const handleReconnect = () => {
    const term = termRef.current
    if (!term) return
    posthogRef.current.capture(TERMINAL_EVENTS.RECONNECTED, {
      sandbox_id: sandboxId,
    })
    connectWebSocket(term)
  }

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={containerRef}
        className="h-full w-full bg-background px-2 pt-2"
      />
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-xs text-muted animate-pulse">
            Connecting...
          </span>
        </div>
      )}
      {(status === "disconnected" || status === "error") && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center p-4">
          <button
            type="button"
            onClick={handleReconnect}
            className="border border-dashed border-border bg-surface px-3 py-1.5 font-mono text-xs uppercase text-foreground hover:bg-surface-hover"
          >
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
}
