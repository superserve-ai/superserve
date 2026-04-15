# Web Terminal — xterm.js Integration

Replaces the one-shot command runner with a full interactive PTY terminal using xterm.js and WebSocket.

## Architecture

Two-step auth flow:

1. Browser calls `POST /api/sandboxes/{id}/terminal-token` through the existing Next.js API proxy (injects `X-API-Key`). Returns a short-lived opaque token + WebSocket URL.
2. Browser opens a WebSocket **directly** to the edge proxy (`wss://{id}.sandbox.superserve.ai/terminal`). Auth via `Sec-WebSocket-Protocol` header — token never in the URL.

PTY data flows directly between browser and edge proxy. The console backend and control plane are not in the data path.

## Components

### `src/lib/api/terminal.ts`

- `mintTerminalToken(sandboxId)` — POST to proxy, returns `{ token, url, subprotocol, expires_at }`.
- Error mapping: 409 = sandbox not active, 429 = rate limited, 401 = not authorized.

### `src/components/sandboxes/terminal.tsx`

Client component wrapping xterm.js:

- Mounts `Terminal` + `FitAddon` into a container div.
- Mints token on mount, opens WebSocket with subprotocol auth: `[subprotocol, "token." + token]`.
- Binary frames for stdin/stdout, text JSON frames for resize/signal control messages.
- `ResizeObserver` triggers `fit()` + sends resize message.
- On disconnect (1006): shows inline "Reconnect" button that mints a fresh token.
- On clean close (1000, shell exit): shows "[session ended]" message.

### Terminal page (`sandboxes/[sandbox_id]/terminal/page.tsx`)

- Keeps existing header with breadcrumb, status badge, stop/start buttons.
- Removes `CommandRunner` ref and clear button (xterm manages its own buffer).
- Renders `<SandboxTerminal>` when sandbox is active/idle, `<ErrorState>` otherwise.

## Wire Format

- **Browser -> Server (binary):** raw stdin bytes from `term.onData`.
- **Server -> Browser (binary):** raw PTY output, written to `term.write`.
- **Browser -> Server (text):** JSON control messages — `{ type: "resize", cols, rows }` and `{ type: "signal", name }`.

## Error Handling

- HTTP errors from token mint: mapped to user-facing messages inline in terminal.
- WebSocket 1006 (abnormal close): "Reconnect" button, mints fresh token.
- WebSocket 1000 (normal close): "[session ended]" message.
- WebSocket 1011 (internal error): error message displayed.

## Reconnect Strategy

Manual reconnect only. A "Reconnect" button appears on abnormal disconnects. No silent retry — avoids burning tokens on flaky connections and keeps the UX explicit.

## Security Constraints

- Token passed only via `Sec-WebSocket-Protocol`, never in URL.
- Token is single-use, 60s TTL, never stored in localStorage/cookies.
- Each terminal session requires its own token.

## PostHog Events

Update `TERMINAL_EVENTS`:
- `terminal_session_started` — WebSocket opened successfully.
- `terminal_session_ended` — WebSocket closed (include close code).
- `terminal_reconnected` — user clicked reconnect.

Remove old events: `terminal_command_executed`, `terminal_command_aborted`.

## Files Changed

| Path | Action |
|---|---|
| `src/lib/api/terminal.ts` | Create — token minting |
| `src/components/sandboxes/terminal.tsx` | Create — xterm.js component |
| `src/app/(dashboard)/sandboxes/[sandbox_id]/terminal/page.tsx` | Rewrite — use new terminal |
| `src/components/sandboxes/command-runner.tsx` | Delete |
| `src/hooks/use-exec-stream.ts` | Delete |
| `src/hooks/use-command-history.ts` | Delete |
| `src/lib/posthog/events.ts` | Update terminal events |
| `package.json` | Add `@xterm/xterm`, `@xterm/addon-fit` |

## Dependencies

- `@xterm/xterm` — terminal emulator
- `@xterm/addon-fit` — auto-fit to container

## Decisions

- No multi-terminal tabs — one terminal per page, users can use browser tabs.
- No silent reconnect — explicit "Reconnect" button on disconnect.
- Existing proxy allowlist already covers `/sandboxes/*/terminal-token`.
- `exec.ts` and `ExecStreamEvent` type kept — used by non-terminal exec features.
