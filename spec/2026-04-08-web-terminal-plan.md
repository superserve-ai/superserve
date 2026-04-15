# Web Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot command runner with a full interactive PTY terminal using xterm.js and WebSocket.

**Architecture:** Browser mints a short-lived token via the existing Next.js API proxy, then opens a WebSocket directly to the edge proxy for PTY I/O. The xterm.js terminal renders PTY output and sends keystrokes as binary frames.

**Tech Stack:** xterm.js, @xterm/addon-fit, WebSocket, Next.js App Router, React 19, PostHog

---

### Task 1: Install Dependencies

**Files:**
- Modify: `apps/console/package.json`

- [ ] **Step 1: Add xterm packages**

Run from repo root:

```bash
bun add @xterm/xterm @xterm/addon-fit --filter @superserve/console
```

- [ ] **Step 2: Verify installation**

```bash
ls node_modules/@xterm/xterm/package.json && ls node_modules/@xterm/addon-fit/package.json
```

Expected: both files exist.

- [ ] **Step 3: Commit**

```bash
git add apps/console/package.json bun.lock
git commit -m "console: add xterm.js dependencies"
```

---

### Task 2: Token Minting API

**Files:**
- Create: `apps/console/src/lib/api/terminal.ts`

- [ ] **Step 1: Create the terminal API module**

Create `apps/console/src/lib/api/terminal.ts`:

```ts
import { apiClient } from "./client"

export interface TerminalTokenResponse {
  token: string
  url: string
  subprotocol: string
  expires_at: string
}

export async function mintTerminalToken(
  sandboxId: string,
): Promise<TerminalTokenResponse> {
  return apiClient<TerminalTokenResponse>(
    `/sandboxes/${sandboxId}/terminal-token`,
    { method: "POST" },
  )
}
```

This uses the existing `apiClient` which hits `/api/sandboxes/{id}/terminal-token` through the Next.js proxy. Error handling (401, 404, 409, 429) is handled by `apiClient` throwing `ApiError` with the status code and server error message.

- [ ] **Step 2: Verify typecheck passes**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/lib/api/terminal.ts
git commit -m "console: add terminal token minting API"
```

---

### Task 3: xterm.js Terminal Component

**Files:**
- Create: `apps/console/src/components/sandboxes/terminal.tsx`

- [ ] **Step 1: Create the terminal component**

Create `apps/console/src/components/sandboxes/terminal.tsx`:

```tsx
"use client"

import { usePostHog } from "posthog-js/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { mintTerminalToken } from "@/lib/api/terminal"
import { TERMINAL_EVENTS } from "@/lib/posthog/events"
import "@xterm/xterm/css/xterm.css"

type Status = "connecting" | "connected" | "disconnected" | "error"

interface Props {
  sandboxId: string
}

export function SandboxTerminal({ sandboxId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [status, setStatus] = useState<Status>("connecting")
  const posthog = usePostHog()

  const connect = useCallback(async () => {
    const container = containerRef.current
    if (!container) return

    // Clean up previous session
    roRef.current?.disconnect()
    wsRef.current?.close(1000, "reconnect")
    termRef.current?.dispose()

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
      fontSize: 13,
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
    fitRef.current = fit
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
        posthog.capture(TERMINAL_EVENTS.SESSION_STARTED, {
          sandbox_id: sandboxId,
        })
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        )
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
        posthog.capture(TERMINAL_EVENTS.SESSION_ENDED, {
          sandbox_id: sandboxId,
          close_code: evt.code,
        })
        if (evt.code === 1000) {
          term.write("\r\n\x1b[33m[session ended]\x1b[0m\r\n")
        } else {
          term.write(
            `\r\n\x1b[31m[disconnected: ${evt.code}]\x1b[0m\r\n`,
          )
        }
        setStatus("disconnected")
      }

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data))
        }
      })

      const ro = new ResizeObserver(() => {
        fit.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          )
        }
      })
      ro.observe(container)
      roRef.current = ro
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      term.write(`\r\n\x1b[31m[error: ${message}]\x1b[0m\r\n`)
      setStatus("error")
    }
  }, [sandboxId, posthog])

  useEffect(() => {
    connect()
    return () => {
      roRef.current?.disconnect()
      wsRef.current?.close(1000, "unmount")
      termRef.current?.dispose()
    }
  }, [connect])

  const handleReconnect = () => {
    posthog.capture(TERMINAL_EVENTS.RECONNECTED, {
      sandbox_id: sandboxId,
    })
    connect()
  }

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={containerRef}
        className="h-full w-full bg-background px-2 pt-2"
      />
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
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors (PostHog events will fail — fixed in next task).

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/components/sandboxes/terminal.tsx
git commit -m "console: add xterm.js terminal component"
```

---

### Task 4: Update PostHog Events

**Files:**
- Modify: `apps/console/src/lib/posthog/events.ts`

- [ ] **Step 1: Replace terminal events**

In `apps/console/src/lib/posthog/events.ts`, replace the `TERMINAL_EVENTS` block:

```ts
export const TERMINAL_EVENTS = {
  SESSION_STARTED: "terminal_session_started",
  SESSION_ENDED: "terminal_session_ended",
  RECONNECTED: "terminal_reconnected",
} as const
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/lib/posthog/events.ts
git commit -m "console: update terminal PostHog events for WebSocket sessions"
```

---

### Task 5: Rewrite Terminal Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/sandboxes/[sandbox_id]/terminal/page.tsx`

- [ ] **Step 1: Rewrite the terminal page**

Replace the entire contents of `apps/console/src/app/(dashboard)/sandboxes/[sandbox_id]/terminal/page.tsx`:

```tsx
"use client"

import {
  ArrowLeftIcon,
  PlayIcon,
  StopIcon,
} from "@phosphor-icons/react"
import { Badge, Button } from "@superserve/ui"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ErrorState } from "@/components/error-state"
import { SandboxTerminal } from "@/components/sandboxes/terminal"
import {
  usePauseSandbox,
  useResumeSandbox,
  useSandbox,
} from "@/hooks/use-sandboxes"
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/lib/sandbox-utils"

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
      <div className="flex-1 bg-background" />
    </div>
  )
}

export default function TerminalPage() {
  const params = useParams<{ sandbox_id: string }>()
  const sandboxId = params.sandbox_id

  const router = useRouter()
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
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" weight="light" />
          </button>
          <Link
            href="/sandboxes/"
            className="text-sm text-muted hover:text-foreground"
          >
            Sandboxes
          </Link>
          <span className="text-muted">/</span>
          <Link
            href={`/sandboxes/${sandboxId}/`}
            className="font-mono text-sm text-muted hover:text-foreground"
          >
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
              sandbox.status === "pausing" || sandbox.status === "failed"
            }
            onClick={() => {
              if (sandbox.status === "active") pauseMutation.mutate(sandbox.id)
              else if (sandbox.status === "idle")
                resumeMutation.mutate(sandbox.id)
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

      {canRun ? (
        <SandboxTerminal sandboxId={sandboxId} />
      ) : (
        <ErrorState
          message="Sandbox is not running. Start it to use the terminal."
          suggestion="Click the Start button above to resume the sandbox."
        />
      )}
    </div>
  )
}
```

Key changes from the old page:
- Removed `CommandRunner` import and `runnerRef`
- Removed "Clear" button (xterm manages its own buffer)
- Removed `TrashIcon` import
- Added `SandboxTerminal` component
- Added `shrink-0` to header to prevent xterm from compressing it

- [ ] **Step 2: Verify typecheck passes**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/\(dashboard\)/sandboxes/\[sandbox_id\]/terminal/page.tsx
git commit -m "console: replace command runner with xterm.js terminal"
```

---

### Task 6: Delete Old Command Runner Files

**Files:**
- Delete: `apps/console/src/components/sandboxes/command-runner.tsx`
- Delete: `apps/console/src/hooks/use-exec-stream.ts`
- Delete: `apps/console/src/hooks/use-command-history.ts`

- [ ] **Step 1: Verify no other imports**

```bash
cd apps/console && grep -r "command-runner\|use-exec-stream\|use-command-history" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules"
```

Expected: only the files themselves and possibly the terminal page (which was already rewritten in Task 5 to not import them). If the terminal page still shows, verify it's the old cached grep — re-read the file to confirm.

- [ ] **Step 2: Delete the files**

```bash
rm apps/console/src/components/sandboxes/command-runner.tsx
rm apps/console/src/hooks/use-exec-stream.ts
rm apps/console/src/hooks/use-command-history.ts
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

- [ ] **Step 4: Verify lint passes**

```bash
cd apps/console && bunx biome check --write .
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/sandboxes/command-runner.tsx apps/console/src/hooks/use-exec-stream.ts apps/console/src/hooks/use-command-history.ts
git commit -m "console: remove old command runner and exec stream hooks"
```

---

### Task 7: Build Verification

- [ ] **Step 1: Run full typecheck**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run lint**

```bash
cd apps/console && bunx biome check .
```

Expected: no errors (or only pre-existing ones).

- [ ] **Step 3: Run build**

```bash
bunx turbo run build --filter=@superserve/console
```

Expected: build succeeds. This verifies the xterm CSS import and all module resolution works in the production build.

- [ ] **Step 4: Fix any issues found, then commit**

If any issues were found and fixed:

```bash
git add -A
git commit -m "console: fix terminal build issues"
```
