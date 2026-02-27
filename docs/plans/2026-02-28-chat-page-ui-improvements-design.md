# Chat Page UI Improvements — Design

## Scope

Improve the playground chat page UX across all areas while maintaining the existing aesthetic (dashed borders, monospace accents, minimal/clean look).

## 1. Message Input

**Current:** Single-line `<input type="text">` with text "Send"/"Stop" buttons inside a dashed-border container.

**Changes:**

- Replace `<input>` with `<textarea>` that auto-resizes from 1 line up to ~6 lines, then scrolls internally.
- Enter submits, Shift+Enter inserts a newline.
- Keep the existing Send/Stop button design and position — buttons stay bottom-aligned inside the container so they don't float up as the textarea grows.
- Increase container height dynamically to match textarea content.
- Add a subtle "Enter to send" hint below the input on desktop.

## 2. Message Display

**Current:** User messages are blue pills, assistant messages are dashed-border cards. Markdown rendered via react-markdown. No copy affordances. Tool calls show name + duration.

**Changes:**

- **Code block copy button:** Small copy icon in the top-right of `<pre>` blocks, visible on hover.
- **Code block language label:** Show the language tag (e.g. "typescript") in the top bar of fenced code blocks.
- **Message copy button:** Hover action on assistant messages to copy the full response text.
- **Tool call expansion:** Make tool calls clickable to toggle showing the input/output JSON.
- **Timestamps on hover:** Show the message creation time as a tooltip on hover.
- **Streaming indicator:** Keep the 3-dot pulse but make it visually lighter — smaller dots, less vertical space.

## 3. Sidebar

**Current:** Flat session list sorted by updatedAt. Delete on hover. No grouping, no search.

**Changes:**

- **Time-based grouping:** Group sessions under "Today", "Yesterday", "Previous 7 days", "Older" headings.
- **Session search:** Small filter input at the top of the sidebar session list.
- **Confirm delete:** Two-step delete — first click turns item red, second click confirms.
- **Title tooltip:** Show full session title on hover for truncated names.
- **Keyboard shortcut:** Cmd/Ctrl+N to create a new session.

## 4. Empty States

**Current:** Generic icon + text for empty/unselected states.

**Changes:**

- **Agent-aware text:** Show agent name in the empty session state: "Start a conversation with {agentName}".
- **Suggested prompts:** 2-3 clickable starter prompt chips below the empty state text.

## 5. General Polish

**Changes:**

- **Scroll-to-bottom button:** Floating button above the input when user has scrolled up, disappears when at bottom.
- **Smart auto-scroll:** Only auto-scroll on new messages if user is near the bottom of the conversation. Preserve scroll position when reading older messages.
- **Focus input on session switch:** Auto-focus the textarea when switching sessions or creating a new chat.
- **Retry on error:** Show a "Retry" button on failed assistant messages instead of requiring re-type.

## Design Constraints

- Maintain the dashed-border, monospace-accent, small-text aesthetic throughout.
- No new color palette — use existing semantic tokens (primary, muted, foreground, surface, border, etc.).
- Keep the current layout structure (header, sidebar, chat area, input).
- All additions should feel native to the existing design language.
