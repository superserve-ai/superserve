# Superserve React Example

A multi-session chat UI built with React, Vite, and Tailwind CSS v4.

The app uses a custom `useSuperserveChat` hook that manages sessions, message streaming, and tool-call tracking on top of the `Superserve` client. Sessions are persisted in localStorage so conversations survive page refreshes.

## Setup

```bash
# Install dependencies
bun install

# Set your API key
echo "VITE_SUPERSERVE_API_KEY=ss_..." > .env

# Start dev server
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## How it works

- `useSuperserveChat` lazily creates a `Superserve` client and manages all chat state (sessions, messages, streaming status)
- Multiple sessions are supported — create, switch, and delete from the sidebar
- Messages are streamed via `client.stream()` with `onText`, `onToolStart`, and `onToolEnd` callbacks
- Vite proxies `/api` requests to `api-staging.superserve.ai` to avoid CORS

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start Vite dev server |
| `bun run build` | Production build to dist |
