# Chat Page UI Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the playground chat page UX with better input, message display, sidebar, empty states, and general polish — while preserving the existing dashed-border minimal aesthetic.

**Architecture:** All changes are confined to `apps/playground/`. We modify existing components (MessageInput, MessageBubble, MessageList, Sidebar, EmptyState, ChatArea, ChatPage) and add small utility functions. We reuse `@superserve/ui` components (Tooltip, Kbd, ConfirmDialog) where possible. No new packages needed.

**Tech Stack:** React, Tailwind CSS v4, react-markdown, @superserve/ui (Tooltip, Kbd, ConfirmDialog), Lucide React icons

---

### Task 1: Upgrade MessageInput to auto-resizing textarea

**Files:**
- Modify: `apps/playground/src/components/MessageInput.tsx`

**Step 1: Replace `<input>` with `<textarea>` and add auto-resize logic**

Replace the full MessageInput component:

```tsx
import { useState, useRef, useEffect, useCallback } from "react"
import { Kbd } from "@superserve/ui"
import type { ChatStatus } from "../types"

interface MessageInputProps {
  status: ChatStatus
  onSend: (message: string) => void
  onStop: () => void
}

const MAX_ROWS = 6
const LINE_HEIGHT = 20 // px, matches text-sm leading-relaxed

export default function MessageInput({
  status,
  onSend,
  onStop,
}: MessageInputProps) {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStreaming = status === "streaming" || status === "creating-session"

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxHeight = LINE_HEIGHT * MAX_ROWS
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden"
  }, [])

  useEffect(() => {
    resize()
  }, [input, resize])

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="space-y-1.5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
        className="flex items-end border border-dashed border-border bg-surface shadow-sm transition-colors focus-within:border-border-focus"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none bg-transparent px-4 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ overflowY: "hidden" }}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="cursor-pointer px-4 py-2.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="m-1 cursor-pointer bg-primary-bg px-5 py-1.5 font-mono text-xs uppercase tracking-wider text-primary transition-colors hover:bg-primary-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
      <p className="hidden text-[11px] text-muted md:block">
        <Kbd>Enter</Kbd> to send, <Kbd>Shift + Enter</Kbd> for new line
      </p>
    </div>
  )
}
```

Key changes:
- `items-center` → `items-end` on the form so the Send/Stop button stays at the bottom as textarea grows.
- `<textarea>` with `rows={1}`, auto-resize via JS up to 6 rows then scrolls.
- Enter submits, Shift+Enter inserts newline.
- `<Kbd>` component from @superserve/ui for the keyboard hint.

**Step 2: Verify the build compiles**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 3: Commit**

```
feat: upgrade chat input to auto-resizing textarea with keyboard hints
```

---

### Task 2: Add code block copy button and language label

**Files:**
- Modify: `apps/playground/src/components/MessageBubble.tsx`
- Modify: `apps/playground/src/index.css`

**Step 1: Create a CodeBlock component used as a custom renderer for react-markdown**

In `MessageBubble.tsx`, add a `CodeBlock` component above the main export and pass it to `<Markdown>` via the `components` prop:

```tsx
function CodeBlock({ className, children, ...props }: React.ComponentProps<"code">) {
  const match = /language-(\w+)/.exec(className || "")
  const language = match?.[1]
  const codeString = String(children).replace(/\n$/, "")
  const [copied, setCopied] = useState(false)

  // Inline code (not inside a <pre>)
  if (!language && !codeString.includes("\n")) {
    return <code className={className} {...props}>{children}</code>
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group/code relative my-3">
      <div className="flex items-center justify-between border border-b-0 border-dashed border-neutral-700 bg-neutral-900 px-4 py-1.5">
        <span className="font-mono text-[11px] text-neutral-500">
          {language ?? "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="cursor-pointer font-mono text-[11px] text-neutral-500 transition-colors hover:text-neutral-300"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="!mt-0 !border-t-0">
        <code className={className} {...props}>{children}</code>
      </pre>
    </div>
  )
}
```

Then in the Markdown rendering, pass the custom component:

```tsx
<Markdown components={{ code: CodeBlock }}>
  {message.content}
</Markdown>
```

**Step 2: Adjust CSS for code blocks inside the new wrapper**

In `index.css`, update the `.markdown-content pre` rule to remove the top margin and top border when it immediately follows the code header:

```css
.markdown-content pre {
  @apply overflow-x-auto border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-xs leading-relaxed text-neutral-300;
}
```

(Remove `my-3` from the pre rule since the wrapper div now handles vertical margin.)

**Step 3: Verify the build compiles**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 4: Commit**

```
feat: add code block language label and copy button
```

---

### Task 3: Add message copy button and timestamp tooltip

**Files:**
- Modify: `apps/playground/src/components/MessageBubble.tsx`

**Step 1: Add a copy button and timestamp tooltip to assistant messages**

Wrap the message bubble content area with a group and add a hover-visible copy button. Use `@superserve/ui` Tooltip for the timestamp.

Add a `formatTime` helper at the top of the file:

```tsx
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
```

Update the outer wrapper of MessageBubble to include a copy button and tooltip:

```tsx
import { Tooltip, TooltipTrigger, TooltipContent, Avatar } from "@superserve/ui"
```

Wrap the entire message row in a Tooltip for the timestamp:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <div className="group flex items-start gap-3">
      {/* ... avatar and content ... */}
      {!isUser && message.content && (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(message.content)}
          className="mt-2.5 shrink-0 cursor-pointer p-1 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          aria-label="Copy message"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
            <path d="M9.5 4.5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5.5a1 1 0 001 1h1.5" />
          </svg>
        </button>
      )}
    </div>
  </TooltipTrigger>
  <TooltipContent>{formatTime(message.createdAt)}</TooltipContent>
</Tooltip>
```

Note: The playground app root must be wrapped in `<TooltipProvider>`. Check if it already is — if not, add it in the app entry point.

**Step 2: Wrap the app in TooltipProvider if needed**

Check `apps/playground/src/App.tsx` (or main entry). If `<TooltipProvider>` is not present, wrap the root:

```tsx
import { TooltipProvider } from "@superserve/ui"

// Wrap the app content:
<TooltipProvider>
  {/* existing app content */}
</TooltipProvider>
```

**Step 3: Verify the build compiles**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 4: Commit**

```
feat: add message copy button and timestamp tooltip on hover
```

---

### Task 4: Make tool calls expandable

**Files:**
- Modify: `apps/playground/src/components/MessageBubble.tsx`

**Step 1: Add expand/collapse state to tool calls**

Replace the existing tool calls section with a clickable toggle:

```tsx
// Inside MessageBubble, add state:
const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())

const toggleTool = (index: number) => {
  setExpandedTools((prev) => {
    const next = new Set(prev)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })
}
```

Replace the tool call display:

```tsx
{message.toolCalls && message.toolCalls.length > 0 && (
  <div className="mt-2 flex flex-col gap-1 border-t border-dashed border-border/50 pt-2">
    {message.toolCalls.map((tc, i) => (
      <div key={i}>
        <button
          type="button"
          onClick={() => toggleTool(i)}
          className="flex w-full cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted transition-colors hover:text-foreground"
        >
          <svg
            width="10" height="10" viewBox="0 0 10 10"
            fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
            className={`transition-transform ${expandedTools.has(i) ? "rotate-90" : ""}`}
          >
            <path d="M3 1.5L7 5L3 8.5" />
          </svg>
          {tc.name}
          <span className="text-ink-faint">
            {tc.duration > 0 ? `${tc.duration}ms` : "..."}
          </span>
        </button>
        {expandedTools.has(i) && (
          <pre className="mt-1 max-h-40 overflow-auto bg-neutral-900 p-2 font-mono text-[10px] leading-relaxed text-neutral-400">
            {JSON.stringify(tc.input, null, 2)}
          </pre>
        )}
      </div>
    ))}
  </div>
)}
```

**Step 2: Verify the build compiles**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 3: Commit**

```
feat: make tool calls expandable to show input JSON
```

---

### Task 5: Reduce streaming indicator visual weight

**Files:**
- Modify: `apps/playground/src/components/MessageBubble.tsx`

**Step 1: Make the streaming dots smaller and remove the full-width card padding**

Change the empty streaming indicator:

```tsx
{isEmpty ? (
  <div className="flex items-center gap-1 py-0.5">
    <span className="size-1 animate-pulse rounded-full bg-muted" />
    <span className="size-1 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
    <span className="size-1 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
  </div>
) : /* ... */}
```

Changes: `gap-1.5` → `gap-1`, `size-1.5` → `size-1`, `py-0.5` stays.

**Step 2: Commit**

```
fix: reduce streaming indicator visual weight
```

---

### Task 6: Sidebar — time-based session grouping

**Files:**
- Modify: `apps/playground/src/components/Sidebar.tsx`
- Modify: `apps/playground/src/utils.ts`

**Step 1: Add a session grouping utility**

In `utils.ts`, add:

```tsx
export function groupByTime<T extends { updatedAt: string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
  const startOfWeek = new Date(startOfToday.getTime() - 7 * 86400000)

  const groups: Record<string, T[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  }

  for (const item of items) {
    const date = new Date(item.updatedAt)
    if (date >= startOfToday) groups["Today"].push(item)
    else if (date >= startOfYesterday) groups["Yesterday"].push(item)
    else if (date >= startOfWeek) groups["Previous 7 days"].push(item)
    else groups["Older"].push(item)
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }))
}
```

**Step 2: Update Sidebar to use grouped sessions**

Replace the flat `.map(sorted)` in Sidebar with grouped rendering:

```tsx
import { relativeTime, groupByTime } from "../utils"

// Inside the component:
const sorted = [...sessions].sort(
  (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
)
const groups = groupByTime(sorted)
```

Replace the session list rendering:

```tsx
<div className="flex-1 overflow-y-auto">
  {groups.map((group) => (
    <div key={group.label}>
      <p className="px-4 pt-4 pb-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        {group.label}
      </p>
      {group.items.map((session) => {
        const isActive = session.localId === activeLocalId
        return (
          <div key={session.localId} /* ... existing session item JSX ... */ >
            {/* same as current */}
          </div>
        )
      })}
    </div>
  ))}
  {sorted.length === 0 && (
    <p className="px-4 py-8 text-center text-[12px] text-muted">
      No conversations yet
    </p>
  )}
</div>
```

**Step 3: Verify the build compiles**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 4: Commit**

```
feat: group sidebar sessions by time period
```

---

### Task 7: Sidebar — session search filter

**Files:**
- Modify: `apps/playground/src/components/Sidebar.tsx`

**Step 1: Add a search input above the session list**

Add state and filter logic:

```tsx
const [search, setSearch] = useState("")

const filtered = sorted.filter((s) =>
  s.title.toLowerCase().includes(search.toLowerCase()),
)
const groups = groupByTime(filtered)
```

Add the search input below the New Chat button:

```tsx
<div className="px-3 pb-2">
  <input
    type="text"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    placeholder="Search chats..."
    className="h-8 w-full border border-dashed border-border bg-transparent px-3 text-xs text-foreground placeholder:text-muted focus:border-border-focus focus:outline-none"
  />
</div>
```

**Step 2: Commit**

```
feat: add session search filter to sidebar
```

---

### Task 8: Sidebar — confirm delete and title tooltip

**Files:**
- Modify: `apps/playground/src/components/Sidebar.tsx`

**Step 1: Add two-step delete confirmation**

Add state to track which session is pending delete:

```tsx
const [pendingDelete, setPendingDelete] = useState<string | null>(null)
```

Update the delete button:

```tsx
<button
  onClick={(e) => {
    e.stopPropagation()
    if (pendingDelete === session.localId) {
      onDeleteSession(session.localId)
      setPendingDelete(null)
    } else {
      setPendingDelete(session.localId)
      // Auto-reset after 3 seconds
      setTimeout(() => setPendingDelete((prev) =>
        prev === session.localId ? null : prev
      ), 3000)
    }
  }}
  className={`ml-2 mt-0.5 shrink-0 cursor-pointer p-0.5 transition-opacity ${
    pendingDelete === session.localId
      ? "text-destructive opacity-100"
      : "text-ink-faint opacity-0 hover:text-ink-light group-hover:opacity-100"
  }`}
  aria-label={pendingDelete === session.localId ? "Click again to confirm delete" : "Delete session"}
>
  {/* same X svg icon */}
</button>
```

**Step 2: Add title tooltip using native `title` attribute**

On the session title `<p>` tag, add a native `title` attribute:

```tsx
<p
  title={session.title}
  className={`truncate text-[13px] ${isActive ? "font-medium text-foreground" : "text-ink"}`}
>
  {session.title}
</p>
```

**Step 3: Commit**

```
feat: add confirm delete and title tooltip in sidebar
```

---

### Task 9: Sidebar — keyboard shortcut for new chat

**Files:**
- Modify: `apps/playground/src/pages/ChatPage.tsx`

**Step 1: Add Cmd/Ctrl+N keyboard listener**

Add a `useEffect` for the keyboard shortcut in ChatPage:

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault()
      handleNewChat()
    }
  }
  window.addEventListener("keydown", handleKeyDown)
  return () => window.removeEventListener("keydown", handleKeyDown)
}, [handleNewChat])
```

Note: `handleNewChat` needs to be wrapped in `useCallback` or this effect needs to be adjusted so the dependency is stable. Wrap it:

```tsx
const handleNewChat = useCallback(() => {
  createSession()
  setSidebarOpen(false)
}, [createSession])
```

**Step 2: Commit**

```
feat: add Cmd/Ctrl+N shortcut for new chat
```

---

### Task 10: Empty state — agent-aware text and suggested prompts

**Files:**
- Modify: `apps/playground/src/components/EmptyState.tsx`
- Modify: `apps/playground/src/components/ChatArea.tsx`

**Step 1: Update EmptyState to accept agent name and onSend**

```tsx
interface EmptyStateProps {
  hasSession: boolean
  agentName?: string
  onSend?: (message: string) => void
}

const STARTER_PROMPTS = [
  "What can you do?",
  "Help me get started",
  "Show me an example",
]
```

In the `hasSession` branch, update the text and add prompt chips:

```tsx
<p className="font-medium text-foreground">
  {agentName ? `Chat with ${agentName}` : "Start a conversation"}
</p>
<p className="mt-1 text-[13px] text-muted">
  Type a message below or try a suggestion.
</p>
{onSend && (
  <div className="mt-4 flex flex-wrap justify-center gap-2">
    {STARTER_PROMPTS.map((prompt) => (
      <button
        key={prompt}
        type="button"
        onClick={() => onSend(prompt)}
        className="cursor-pointer border border-dashed border-border px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-border-focus hover:text-foreground"
      >
        {prompt}
      </button>
    ))}
  </div>
)}
```

**Step 2: Pass agentName and onSend from ChatArea**

Update ChatArea props and pass them down:

```tsx
interface ChatAreaProps {
  session: ChatSession | null
  status: ChatStatus
  agentName?: string
  onSend: (message: string) => void
  onStop: () => void
}

// In the empty state rendering:
<EmptyState
  hasSession={session !== null}
  agentName={agentName}
  onSend={session ? onSend : undefined}
/>
```

Update ChatPage to pass `agentName` to ChatArea:

```tsx
<ChatArea
  session={activeSession}
  status={status}
  agentName={agentName ?? undefined}
  onSend={sendMessage}
  onStop={stopStream}
/>
```

**Step 3: Verify the build compiles**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 4: Commit**

```
feat: add agent-aware empty state with suggested prompts
```

---

### Task 11: Smart auto-scroll and scroll-to-bottom button

**Files:**
- Modify: `apps/playground/src/components/MessageList.tsx`

**Step 1: Replace the naive auto-scroll with proximity-based scroll**

```tsx
import { useEffect, useRef, useState, useCallback } from "react"
import type { ChatMessage } from "../types"
import MessageBubble from "./MessageBubble"

interface MessageListProps {
  messages: ChatMessage[]
}

export default function MessageList({ messages }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const isNearBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }, [])

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    if (isNearBottom()) {
      scrollToBottom()
    }
  }, [messages, isNearBottom, scrollToBottom])

  const handleScroll = () => {
    setShowScrollBtn(!isNearBottom())
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="relative">
      <div className="flex flex-col gap-5">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={endRef} />
      </div>
      {showScrollBtn && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="fixed bottom-20 left-1/2 z-20 -translate-x-1/2 cursor-pointer border border-dashed border-border bg-surface px-3 py-1.5 text-[11px] text-muted shadow-sm transition-colors hover:text-foreground"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="inline mr-1">
            <path d="M6 2v8M2.5 6.5L6 10l3.5-3.5" />
          </svg>
          Scroll to bottom
        </button>
      )}
    </div>
  )
}
```

Note: The scroll container is actually the parent `<main>` in ChatArea, not MessageList itself. The `containerRef` should attach to the scrollable ancestor. Adjust by moving the scroll listener to ChatArea or using a ref callback. The implementer should check which element has `overflow-y-auto` (it's the `<main>` in ChatArea) and attach the scroll handler there. The simplest approach: pass a `scrollContainerRef` from ChatArea to MessageList, or move the scroll logic into ChatArea.

**Step 2: Verify the build compiles**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 3: Commit**

```
feat: add smart auto-scroll and scroll-to-bottom button
```

---

### Task 12: Focus input on session switch

**Files:**
- Modify: `apps/playground/src/components/MessageInput.tsx`

**Step 1: Expose a ref and auto-focus**

Export the textarea ref via `useImperativeHandle` or simply use `autoFocus`. The simplest approach: add an `autoFocus` prop or use a key to re-mount on session change.

In ChatArea, add a `key` prop on MessageInput tied to the session:

```tsx
<MessageInput
  key={session?.localId}
  status={status}
  onSend={onSend}
  onStop={onStop}
/>
```

In MessageInput, add autoFocus to the textarea:

```tsx
<textarea
  ref={textareaRef}
  autoFocus
  // ...rest of props
/>
```

**Step 2: Commit**

```
feat: auto-focus input on session switch
```

---

### Task 13: Retry on error

**Files:**
- Modify: `apps/playground/src/components/MessageBubble.tsx`
- Modify: `apps/playground/src/components/MessageList.tsx`
- Modify: `apps/playground/src/components/ChatArea.tsx`

**Step 1: Pass onRetry callback through the component tree**

Add an `onRetry` prop to ChatArea:

```tsx
interface ChatAreaProps {
  session: ChatSession | null
  status: ChatStatus
  agentName?: string
  onSend: (message: string) => void
  onStop: () => void
  onRetry?: (messageContent: string) => void
}
```

Pass it to MessageList, then to MessageBubble.

In MessageBubble, detect error messages (content starts with "Error:") and show a retry button:

```tsx
{!isUser && message.content.startsWith("Error:") && onRetry && (
  <button
    type="button"
    onClick={() => {
      // Find the user message that preceded this — the parent should pass it
      onRetry()
    }}
    className="mt-2 cursor-pointer border border-dashed border-border px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:text-foreground"
  >
    Retry
  </button>
)}
```

For the retry logic: the `onRetry` callback in ChatPage should find the last user message in the session and re-send it. Add this to `useSuperserveChat`:

```tsx
const retryLastMessage = useCallback(() => {
  if (!activeSession) return
  const lastUserMsg = [...activeSession.messages]
    .reverse()
    .find((m) => m.role === "user")
  if (lastUserMsg) {
    // Remove the failed assistant message, then re-send
    setSessions((prev) =>
      prev.map((s) => {
        if (s.localId !== activeLocalId) return s
        // Remove the last assistant message (the error one)
        const messages = [...s.messages]
        if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
          messages.pop()
        }
        // Also remove the user message that triggered it
        if (messages.length > 0 && messages[messages.length - 1].role === "user") {
          messages.pop()
        }
        return { ...s, messages }
      }),
    )
    // Re-send after state update
    setTimeout(() => sendMessage(lastUserMsg.content), 0)
  }
}, [activeSession, activeLocalId, setSessions, sendMessage])
```

**Step 2: Wire retry through ChatPage → ChatArea → MessageList → MessageBubble**

Pass `onRetry={retryLastMessage}` from ChatPage to ChatArea. ChatArea passes it to MessageList. MessageList passes it to the last MessageBubble (only the last assistant message needs it).

**Step 3: Verify the build compiles**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 4: Commit**

```
feat: add retry button on failed assistant messages
```

---

### Task 14: Final build verification and cleanup

**Step 1: Run full build**

Run: `bunx turbo run build --filter=@superserve/playground`

**Step 2: Run lint**

Run: `bunx turbo run lint --filter=@superserve/playground`

**Step 3: Fix any lint issues**

**Step 4: Run typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/playground`

**Step 5: Final commit if any cleanup was needed**

```
chore: fix lint and type issues from UI improvements
```
