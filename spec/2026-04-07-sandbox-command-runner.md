# Sandbox Command Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a command execution interface to sandboxes — type a command, see streaming output in real-time, with command history and a full-page terminal view.

**Architecture:** A `CommandRunner` component wraps a command input and a scrollable output area. Commands are sent via the existing `execCommandStream()` function which POSTs to `/api/sandboxes/:id/exec/stream` and returns SSE events. Output is rendered as styled `<pre>` blocks (no xterm.js needed — this is command execution, not an interactive PTY). Command history is persisted to localStorage per sandbox.

**Tech Stack:** React, SSE via fetch + ReadableStream, localStorage for history, existing `@superserve/ui` components, Phosphor icons.

---

## File Structure

| File | Responsibility |
|---|---|
| `components/sandboxes/command-runner.tsx` | Main command runner component: input, output area, streaming logic |
| `hooks/use-command-history.ts` | localStorage-backed command history per sandbox |
| `hooks/use-exec-stream.ts` | SSE streaming hook — sends command, parses events, manages state |
| `app/(dashboard)/sandboxes/[sandbox_id]/terminal/page.tsx` | Full-page terminal route |
| `app/(dashboard)/sandboxes/[sandbox_id]/page.tsx` | Modify: add compact command runner section |
| `app/(dashboard)/sandboxes/page.tsx` | Modify: wire "Open Terminal" menu item |
| `lib/posthog/events.ts` | Modify: add TERMINAL_EVENTS |

---

### Task 1: SSE Streaming Hook

**Files:**
- Create: `apps/console/src/hooks/use-exec-stream.ts`

This hook manages the lifecycle of a single command execution: idle → running → done/error. It parses the SSE `data:` lines from the fetch ReadableStream and accumulates output.

- [ ] **Step 1: Create the hook**

```ts
// apps/console/src/hooks/use-exec-stream.ts
import { useCallback, useRef, useState } from "react"
import type { ExecStreamEvent } from "@/lib/api/types"

export interface OutputLine {
  type: "stdout" | "stderr" | "error" | "exit"
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
      // Abort any running command
      abortRef.current?.abort()

      const controller = new AbortController()
      abortRef.current = controller

      setState({ status: "running", output: [], exitCode: null })

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
          const message =
            body?.error?.message ?? `HTTP ${response.status}`
          setState((s) => ({
            ...s,
            status: "error",
            output: [
              ...s.output,
              {
                type: "error",
                text: message,
                timestamp: new Date().toISOString(),
              },
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
                  newOutput.push({
                    type: "stdout",
                    text: event.stdout,
                    timestamp: event.timestamp,
                  })
                }
                if (event.stderr) {
                  newOutput.push({
                    type: "stderr",
                    text: event.stderr,
                    timestamp: event.timestamp,
                  })
                }
                if (event.error) {
                  newOutput.push({
                    type: "error",
                    text: event.error,
                    timestamp: event.timestamp,
                  })
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
                    ? event.exit_code === 0
                      ? "done"
                      : "error"
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
```

- [ ] **Step 2: Verify no lint errors**

Run: `bunx biome check apps/console/src/hooks/use-exec-stream.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/hooks/use-exec-stream.ts
git commit -m "console: add SSE streaming hook for command execution"
```

---

### Task 2: Command History Hook

**Files:**
- Create: `apps/console/src/hooks/use-command-history.ts`

Stores up to 50 commands per sandbox in localStorage keyed by sandbox ID. Provides up/down arrow navigation.

- [ ] **Step 1: Create the hook**

```ts
// apps/console/src/hooks/use-command-history.ts
import { useCallback, useRef, useState } from "react"

const STORAGE_PREFIX = "superserve-cmd-history-"
const MAX_HISTORY = 50

function loadHistory(sandboxId: string): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${sandboxId}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(sandboxId: string, history: string[]) {
  localStorage.setItem(
    `${STORAGE_PREFIX}${sandboxId}`,
    JSON.stringify(history.slice(0, MAX_HISTORY)),
  )
}

export function useCommandHistory(sandboxId: string) {
  const [history, setHistory] = useState<string[]>(() =>
    loadHistory(sandboxId),
  )
  const indexRef = useRef(-1)
  const draftRef = useRef("")

  const push = useCallback(
    (command: string) => {
      const trimmed = command.trim()
      if (!trimmed) return
      const next = [trimmed, ...history.filter((h) => h !== trimmed)].slice(
        0,
        MAX_HISTORY,
      )
      setHistory(next)
      saveHistory(sandboxId, next)
      indexRef.current = -1
      draftRef.current = ""
    },
    [sandboxId, history],
  )

  const navigate = useCallback(
    (direction: "up" | "down", currentInput: string): string | null => {
      if (history.length === 0) return null

      if (indexRef.current === -1) {
        draftRef.current = currentInput
      }

      if (direction === "up") {
        const next = Math.min(indexRef.current + 1, history.length - 1)
        indexRef.current = next
        return history[next]
      }

      const next = indexRef.current - 1
      if (next < 0) {
        indexRef.current = -1
        return draftRef.current
      }
      indexRef.current = next
      return history[next]
    },
    [history],
  )

  const reset = useCallback(() => {
    indexRef.current = -1
    draftRef.current = ""
  }, [])

  return { history, push, navigate, reset }
}
```

- [ ] **Step 2: Verify no lint errors**

Run: `bunx biome check apps/console/src/hooks/use-command-history.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/hooks/use-command-history.ts
git commit -m "console: add localStorage-backed command history hook"
```

---

### Task 3: Command Runner Component

**Files:**
- Create: `apps/console/src/components/sandboxes/command-runner.tsx`

The core UI component. Design constraints:
- No border-radius — flat blocks separated by borders, consistent with list pages
- Monospace font for output
- Sticky input bar at the bottom with `$` prompt
- Output area scrolls, auto-scrolls on new output
- Exit code shown as badge (success/error)
- Ctrl+C to abort running command
- Up/down arrows navigate command history
- Clear button to reset output
- Running state shows a pulsing indicator

- [ ] **Step 1: Create the component**

```tsx
// apps/console/src/components/sandboxes/command-runner.tsx
"use client"

import { StopIcon, TrashIcon } from "@phosphor-icons/react"
import { Badge, Button, cn } from "@superserve/ui"
import { useEffect, useRef } from "react"
import { useCommandHistory } from "@/hooks/use-command-history"
import { useExecStream, type OutputLine } from "@/hooks/use-exec-stream"

interface CommandRunnerProps {
  sandboxId: string
  compact?: boolean
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
      )}
    >
      {line.text}
    </span>
  )
}

export function CommandRunner({ sandboxId, compact }: CommandRunnerProps) {
  const { status, output, exitCode, execute, abort, clear } =
    useExecStream(sandboxId)
  const { push, navigate, reset } = useCommandHistory(sandboxId)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const isRunning = status === "running"

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || isRunning) return
    push(trimmed)
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

  const maxHeight = compact ? "max-h-64" : "flex-1"

  return (
    <div className="flex flex-col">
      {/* Output area */}
      <div
        ref={outputRef}
        className={cn(
          "overflow-y-auto bg-background px-4 py-3",
          maxHeight,
          output.length === 0 && !isRunning && "hidden",
        )}
      >
        {output.map((line, i) => (
          <OutputBlock key={i} line={line} />
        ))}
        {isRunning && (
          <span className="inline-block size-2 animate-pulse bg-foreground/60" />
        )}
      </div>

      {/* Exit code bar */}
      {status === "done" || status === "error" ? (
        <div className="flex items-center justify-between border-t border-border px-4 py-1.5">
          <Badge variant={exitCode === 0 ? "success" : "destructive"} dot>
            {exitCode === 0 ? "Success" : `Exit ${exitCode}`}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={clear}
            aria-label="Clear output"
          >
            <TrashIcon className="size-3.5" weight="light" />
          </Button>
        </div>
      ) : null}

      {/* Input bar */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2">
        <span className="font-mono text-xs text-muted select-none">$</span>
        <input
          ref={inputRef}
          type="text"
          placeholder={isRunning ? "Running..." : "Enter a command"}
          disabled={isRunning}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder:text-muted outline-none disabled:opacity-50"
          aria-label="Command input"
        />
        {isRunning && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={abort}
            aria-label="Stop command"
          >
            <StopIcon className="size-3.5" weight="light" />
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify no lint errors**

Run: `bunx biome check apps/console/src/components/sandboxes/command-runner.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/components/sandboxes/command-runner.tsx
git commit -m "console: add command runner component"
```

---

### Task 4: Add Command Runner to Sandbox Detail Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/sandboxes/[sandbox_id]/page.tsx`

Add a "Terminal" section between the info grid and Activity section. Uses the compact variant. Only shown when sandbox is active or idle (auto-wake will handle idle).

- [ ] **Step 1: Add import and section**

Add to imports at top of file:

```tsx
import { CommandRunner } from "@/components/sandboxes/command-runner"
import { TerminalIcon } from "@phosphor-icons/react"
```

Add the Terminal section after the info grid's closing `</div>` and before the Activity section header. Find the line:

```tsx
        {/* Activity Section */}
        <div className="flex h-10 items-center border-b border-border px-4">
```

Insert before it:

```tsx
        {/* Terminal Section */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <h2 className="text-sm font-medium text-foreground">Terminal</h2>
        </div>
        {sandbox.status === "active" || sandbox.status === "idle" ? (
          <div className="border-b border-border">
            <CommandRunner sandboxId={sandboxId} compact />
          </div>
        ) : (
          <div className="border-b border-border">
            <EmptyState
              icon={TerminalIcon}
              title="Sandbox Not Running"
              description="Start this sandbox to run commands."
            />
          </div>
        )}
```

- [ ] **Step 2: Verify build passes**

Run: `bunx turbo run build --filter=@superserve/console`

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/\(dashboard\)/sandboxes/\[sandbox_id\]/page.tsx
git commit -m "console: add command runner section to sandbox detail page"
```

---

### Task 5: Full-Page Terminal Route

**Files:**
- Create: `apps/console/src/app/(dashboard)/sandboxes/[sandbox_id]/terminal/page.tsx`

Full-page view: header with breadcrumb + status, rest of the page is the command runner at full height. Sandbox must be active or idle.

- [ ] **Step 1: Create the page**

```tsx
// apps/console/src/app/(dashboard)/sandboxes/[sandbox_id]/terminal/page.tsx
"use client"

import { ArrowLeftIcon, PlayIcon, StopIcon } from "@phosphor-icons/react"
import { Badge, type BadgeVariant, Button } from "@superserve/ui"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ErrorState } from "@/components/error-state"
import { CommandRunner } from "@/components/sandboxes/command-runner"
import { usePauseSandbox, useResumeSandbox, useSandbox } from "@/hooks/use-sandboxes"
import type { SandboxStatus } from "@/lib/api/types"

const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = {
  active: "success",
  starting: "warning",
  pausing: "warning",
  idle: "muted",
  deleted: "destructive",
}

const STATUS_LABEL: Record<SandboxStatus, string> = {
  active: "Active",
  starting: "Starting",
  pausing: "Pausing",
  idle: "Idle",
  deleted: "Deleted",
}

function TerminalSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-border px-6">
        <div className="h-4 w-24 animate-pulse bg-muted/20" />
        <span className="text-muted">/</span>
        <div className="h-4 w-32 animate-pulse bg-muted/20" />
        <span className="text-muted">/</span>
        <div className="h-4 w-20 animate-pulse bg-muted/20" />
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2 border-t border-border px-4 py-2">
        <span className="font-mono text-xs text-muted">$</span>
        <div className="h-3 w-48 animate-pulse bg-muted/20" />
      </div>
    </div>
  )
}

export default function TerminalPage() {
  const params = useParams<{ sandbox_id: string }>()
  const sandboxId = params.sandbox_id

  const { data: sandbox, isPending, error, refetch } = useSandbox(sandboxId)
  const pauseMutation = usePauseSandbox()
  const resumeMutation = useResumeSandbox()

  if (isPending) return <TerminalSkeleton />

  if (error || !sandbox) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-6">
          <Link
            href="/sandboxes/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            Sandboxes
          </Link>
        </div>
        <ErrorState
          message={error?.message ?? "Sandbox not found"}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const canRun = sandbox.status === "active" || sandbox.status === "idle"

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/sandboxes/${sandboxId}/`}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
            {sandbox.name}
          </Link>
          <span className="text-muted">/</span>
          <h1 className="text-sm font-medium text-foreground">Terminal</h1>
          <Badge variant={STATUS_BADGE_VARIANT[sandbox.status]} dot>
            {STATUS_LABEL[sandbox.status]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={
              sandbox.status === "starting" || sandbox.status === "pausing"
            }
            onClick={() => {
              if (sandbox.status === "active") {
                pauseMutation.mutate(sandbox.id)
              } else if (sandbox.status === "idle") {
                resumeMutation.mutate(sandbox.id)
              }
            }}
          >
            {sandbox.status === "active" || sandbox.status === "pausing" ? (
              <>
                <StopIcon className="size-3.5" weight="light" />
                Stop
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" weight="light" />
                Start
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Terminal body */}
      {canRun ? (
        <CommandRunner sandboxId={sandboxId} />
      ) : (
        <ErrorState
          message="Sandbox is not running. Start it to use the terminal."
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run: `bunx turbo run build --filter=@superserve/console`

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/\(dashboard\)/sandboxes/\[sandbox_id\]/terminal/
git commit -m "console: add full-page terminal route"
```

---

### Task 6: Wire "Open Terminal" Menu Item on List Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/sandboxes/page.tsx`

The "Open Terminal" `MenuItem` in the 3-dots menu currently does nothing. Wire it to navigate to `/sandboxes/[id]/terminal/`.

- [ ] **Step 1: Add onClick handler**

Find the MenuItem:

```tsx
                            <MenuItem>
                              <TerminalIcon className="size-4" weight="light" />
                              Open Terminal
                            </MenuItem>
```

Replace with:

```tsx
                            <MenuItem
                              onClick={() =>
                                router.push(
                                  `/sandboxes/${sandbox.id}/terminal/`,
                                )
                              }
                            >
                              <TerminalIcon className="size-4" weight="light" />
                              Open Terminal
                            </MenuItem>
```

`router` is already imported and defined (added in earlier work for row click navigation).

- [ ] **Step 2: Verify build passes**

Run: `bunx turbo run build --filter=@superserve/console`

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/\(dashboard\)/sandboxes/page.tsx
git commit -m "console: wire Open Terminal menu item to terminal page"
```

---

### Task 7: PostHog Events

**Files:**
- Modify: `apps/console/src/lib/posthog/events.ts`
- Modify: `apps/console/src/components/sandboxes/command-runner.tsx`

- [ ] **Step 1: Add terminal events**

Add to `events.ts` after `SANDBOX_EVENTS`:

```ts
export const TERMINAL_EVENTS = {
  COMMAND_EXECUTED: "terminal_command_executed",
  COMMAND_ABORTED: "terminal_command_aborted",
} as const
```

- [ ] **Step 2: Add posthog tracking to CommandRunner**

Add imports in `command-runner.tsx`:

```tsx
import { usePostHog } from "posthog-js/react"
import { TERMINAL_EVENTS } from "@/lib/posthog/events"
```

Add `const posthog = usePostHog()` inside the component.

In `handleSubmit`, add after `push(trimmed)`:

```tsx
posthog.capture(TERMINAL_EVENTS.COMMAND_EXECUTED, { sandbox_id: sandboxId })
```

In the abort button's `onClick`, add before `abort()`:

```tsx
posthog.capture(TERMINAL_EVENTS.COMMAND_ABORTED, { sandbox_id: sandboxId })
```

- [ ] **Step 3: Verify lint and build**

Run: `bunx biome check apps/console/src/lib/posthog/events.ts apps/console/src/components/sandboxes/command-runner.tsx`
Run: `bunx turbo run build --filter=@superserve/console`

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/lib/posthog/events.ts apps/console/src/components/sandboxes/command-runner.tsx
git commit -m "console: add posthog tracking for terminal commands"
```

---

## Design Notes

- **No border-radius** — all elements are flat blocks separated by `border-border`
- **Monospace** — `font-mono text-xs` for all terminal content (input, output, exit codes)
- **Color coding** — stdout: `text-foreground/80`, stderr: `text-yellow-400/80`, errors: `text-destructive`, exit info: `text-muted`
- **Running indicator** — pulsing square (`animate-pulse bg-foreground/60`), not a spinner
- **Flush layout** — output area, status bar, and input bar are full-width blocks with `px-4`, matching table cell padding
- **Compact mode** — `max-h-64` on detail page, full `flex-1` on terminal page
- **Input styling** — bare input with `$` prompt, no border, transparent background, matching the product's minimal aesthetic
