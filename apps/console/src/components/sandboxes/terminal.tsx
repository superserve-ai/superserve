"use client"

import { WTerm } from "@wterm/dom"
import { GhosttyCore } from "@wterm/ghostty"
import { usePostHog } from "posthog-js/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { TERMINAL_EVENTS } from "@/lib/posthog/events"
import "@wterm/dom/css"

export type TerminalConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

const encoder = new TextEncoder()
const TERMINAL_SUBPROTOCOL = "superserve.terminal.v1"
const SANDBOX_HOST =
  process.env.NEXT_PUBLIC_SANDBOX_HOST ?? "sandbox.superserve.ai"

interface Props {
  sandboxId: string
  accessToken: string
  /**
   * Whether this terminal is the foreground tab. When true, the component
   * focuses wterm on connect and again when this tab becomes active. Defaults
   * to true so single-tab usage is unchanged.
   */
  isActive?: boolean
  /**
   * Called whenever the WebSocket lifecycle status changes. Used by the
   * multi-tab container to surface a status indicator per tab.
   */
  onStatusChange?: (status: TerminalConnectionStatus) => void
}

export function SandboxTerminal({
  sandboxId,
  accessToken,
  isActive = true,
  onStatusChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<WTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const isActiveRef = useRef(isActive)
  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  const onStatusChangeRef = useRef(onStatusChange)
  const [status, setStatus] = useState<TerminalConnectionStatus>("connecting")

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    onStatusChangeRef.current?.(status)
  }, [status])

  // Keep posthog ref current without triggering reconnects
  useEffect(() => {
    posthogRef.current = posthog
  }, [posthog])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  const connectWebSocket = useCallback(
    (term: WTerm) => {
      // Clean up previous WebSocket
      wsRef.current?.close(1000, "reconnect")
      setStatus("connecting")

      try {
        const url = `wss://boxd-${sandboxId}.${SANDBOX_HOST}/terminal`
        const ws = new WebSocket(url, [
          TERMINAL_SUBPROTOCOL,
          `token.${accessToken}`,
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
          // Don't steal focus from another tab if this terminal is mounted
          // hidden — only focus when this is the foreground tab.
          if (isActiveRef.current) term.focus()
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
          const label =
            evt.code === 1000
              ? "\x1b[33m[session ended]\x1b[0m"
              : evt.code === 1001
                ? "\x1b[33m[sandbox going away]\x1b[0m"
                : evt.code === 1006
                  ? "\x1b[31m[connection lost]\x1b[0m"
                  : `\x1b[31m[disconnected: ${evt.code}]\x1b[0m`
          term.write(`\r\n${label}\r\n`)
          setStatus("disconnected")
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        term.write(`\r\n\x1b[31m[error: ${message}]\x1b[0m\r\n`)
        setStatus("error")
      }
    },
    [sandboxId, accessToken],
  )

  // Initialize terminal once on mount. Both GhosttyCore.load() and term.init()
  // are async (WASM load + container measurement), so guard with a cancellation
  // flag to avoid destroying a half-initialized instance.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false

    ;(async () => {
      try {
        const core = await GhosttyCore.load()
        if (cancelled) return

        const term = new WTerm(container, {
          core,
          cursorBlink: true,
          onData: (data) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(encoder.encode(data))
            }
          },
          // Skip 0×0 / 1×1 resizes — wterm's auto-resize observer briefly sees
          // these when a hidden tab is offscreen, and we don't want the remote
          // shell redrawing its TUI (htop, opencode, etc.) at 1×1.
          onResize: (cols, rows) => {
            if (cols < 2 || rows < 2) return
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }))
            }
          },
        })

        await term.init()
        if (cancelled) {
          term.destroy()
          return
        }

        termRef.current = term
        connectWebSocket(term)
      } catch (err) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.error("Failed to initialize terminal:", err)
        setStatus("error")
      }
    })()

    return () => {
      cancelled = true
      wsRef.current?.close(1000, "unmount")
      termRef.current?.destroy()
      termRef.current = null
    }
  }, [connectWebSocket])

  // When this terminal becomes the foreground tab, focus. wterm's autoResize
  // observer handles dimension recalculation on visibility changes.
  useEffect(() => {
    if (!isActive) return
    const term = termRef.current
    if (!term) return
    const rafId = requestAnimationFrame(() => term.focus())
    return () => cancelAnimationFrame(rafId)
  }, [isActive])

  const handleReconnect = () => {
    const term = termRef.current
    if (!term) return
    posthogRef.current.capture(TERMINAL_EVENTS.RECONNECTED, {
      sandbox_id: sandboxId,
    })
    connectWebSocket(term)
  }

  return (
    <div className="relative flex h-full flex-col bg-background p-2">
      <div ref={containerRef} className="h-full w-full" />
      {status === "connecting" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
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
