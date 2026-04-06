// src/hooks/use-exec-stream.ts
import { useCallback, useRef, useState } from "react"
import type { ExecStreamEvent } from "@/lib/api/types"

export interface OutputLine {
  type: "stdout" | "stderr" | "error" | "exit" | "command"
  text: string
  timestamp: string
}

interface ExecStreamState {
  status: "idle" | "running" | "done" | "error"
  output: OutputLine[]
  exitCode: number | null
}

export function useExecStream(sandboxId: string) {
  const [state, setState] = useState<ExecStreamState>({
    status: "idle",
    output: [],
    exitCode: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  const execute = useCallback(
    async (command: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setState((s) => ({
        status: "running",
        output: [
          ...s.output,
          { type: "command", text: `$ ${command}`, timestamp: new Date().toISOString() },
        ],
        exitCode: null,
      }))

      const apiKey =
        typeof window !== "undefined"
          ? localStorage.getItem("superserve-api-key")
          : null

      try {
        const response = await fetch(
          `/api/sandboxes/${sandboxId}/exec/stream`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey ? { "X-API-Key": apiKey } : {}),
            },
            body: JSON.stringify({ command }),
            signal: controller.signal,
          },
        )

        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          const message = body?.error?.message ?? `HTTP ${response.status}`
          setState((s) => ({
            ...s,
            status: "error",
            output: [
              ...s.output,
              { type: "error", text: message, timestamp: new Date().toISOString() },
            ],
          }))
          return
        }

        const reader = response.body?.getReader()
        if (!reader) return

        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const json = line.slice(6)
            if (!json) continue

            try {
              const event: ExecStreamEvent = JSON.parse(json)
              setState((s) => {
                const newOutput = [...s.output]
                if (event.stdout) {
                  newOutput.push({ type: "stdout", text: event.stdout, timestamp: event.timestamp })
                }
                if (event.stderr) {
                  newOutput.push({ type: "stderr", text: event.stderr, timestamp: event.timestamp })
                }
                if (event.error) {
                  newOutput.push({ type: "error", text: event.error, timestamp: event.timestamp })
                }
                if (event.finished) {
                  newOutput.push({
                    type: "exit",
                    text: `Process exited with code ${event.exit_code ?? 0}`,
                    timestamp: event.timestamp,
                  })
                }
                return {
                  output: newOutput,
                  exitCode: event.exit_code ?? s.exitCode,
                  status: event.finished
                    ? event.exit_code === 0 ? "done" : "error"
                    : "running",
                }
              })
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setState((s) => ({
          ...s,
          status: "error",
          output: [
            ...s.output,
            {
              type: "error",
              text: err instanceof Error ? err.message : "Unknown error",
              timestamp: new Date().toISOString(),
            },
          ],
        }))
      }
    },
    [sandboxId],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState((s) => ({
      ...s,
      status: s.status === "running" ? "error" : s.status,
    }))
  }, [])

  const clear = useCallback(() => {
    setState({ status: "idle", output: [], exitCode: null })
  }, [])

  return { ...state, execute, abort, clear }
}
