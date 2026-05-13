"use client"

import { ClipboardAddon } from "@xterm/addon-clipboard"
import { FitAddon } from "@xterm/addon-fit"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import { usePostHog } from "posthog-js/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { TERMINAL_EVENTS } from "@/lib/posthog/events"

import "@xterm/xterm/css/xterm.css"

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
   * focuses xterm on connect and refits whenever it becomes active (the
   * container may have been `display: none` while inactive, leaving xterm
   * with stale dimensions). Defaults to true so single-tab usage is unchanged.
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
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    (term: Terminal) => {
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

  // Initialize terminal once on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      // Stop macOS Option from inserting diacritics into pastes/keystrokes.
      macOptionIsMeta: true,
      // Required by Unicode11Addon.
      allowProposedApi: true,
      scrollback: 5000,
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

    // WebGL renderer — big perf win over canvas. On context loss, dispose so
    // xterm falls back to its canvas renderer automatically.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // WebGL unavailable (headless/older browsers) — canvas fallback is fine.
    }

    // Modern Unicode width tables: fixes emoji and CJK alignment.
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = "11"

    // Proper bracketed-paste handling + OSC 52 clipboard.
    term.loadAddon(new ClipboardAddon())

    fit.fit()
    termRef.current = term
    fitRef.current = fit

    // Forward keystrokes to WebSocket
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(encoder.encode(data))
      }
    })

    // Debounced resize: refit terminal and notify server.
    // Skip when the container is hidden (0×0) — sending a tiny resize would
    // make the remote shell redraw its TUI (htop, opencode, etc.) at 1×1, and
    // the user sees that tiny snapshot briefly when switching back. Keeping
    // the shell's idea of the size stable across tab switches avoids the flash.
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width === 0 || rect.height === 0) return
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
      fitRef.current = null
    }
  }, [connectWebSocket])

  // When this terminal becomes the foreground tab, refit (its container may
  // have been hidden) and focus. The RAF gives layout a chance to settle.
  useEffect(() => {
    if (!isActive) return
    const term = termRef.current
    const fit = fitRef.current
    const container = containerRef.current
    if (!term || !fit || !container) return
    const rafId = requestAnimationFrame(() => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        // Layout hasn't settled yet; the ResizeObserver will pick it up.
        term.focus()
        return
      }
      try {
        fit.fit()
      } catch {
        // FitAddon can throw if dimensions aren't sensible — skip the resize.
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        )
      }
      term.focus()
    })
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
          <span className="animate-pulse font-mono text-xs text-muted">
            Connecting...
          </span>
        </div>
      )}
      {(status === "disconnected" || status === "error") && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center p-4">
          <button
            type="button"
            onClick={handleReconnect}
            className="border border-dashed border-border bg-surface px-3 py-1.5 font-mono text-xs text-foreground uppercase hover:bg-surface-hover"
          >
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
}
