# Console Color & Surface Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the console's color and surface treatment in line with the marketing website — a mint-green brand accent, a warmer charcoal canvas, translucent-white borders, and tasteful frosted-glass surfaces — without touching layout, motion, or the existing density.

**Architecture:** This is primarily a **token operation**. Add brand tokens and repoint `--color-primary` to brand in one theme file; that alone flips ~80% of the accent surface to mint because `primary` already backs buttons, links, selected tabs, checked controls, and progress. The rest is a short list of surgical class edits for on-mint text contrast, status semantics (mint = "running"), and localized `backdrop-blur` translucency. Design doc: `spec/2026-05-27-console-color-refresh-design.md`.

**Tech Stack:** Tailwind CSS v4 (`@theme` tokens in `packages/tailwind-config/theme.css`), React 19 / Next.js 16 console, `@superserve/ui` component library, Vitest (console only), oxlint + oxfmt.

---

## Testing Philosophy (read first)

This is a color/surface refresh. **Most changes are token or CSS-class edits with no meaningful unit test** — asserting "the border is now `rgba(255,255,255,0.08)`" tests the framework, not our logic. For those, verification is `bun run typecheck` + `bun run lint` + a **visual checklist** in the running app.

TDD _is_ applied where it adds real value:

- **Task 5** (status → badge-variant mapping) is pure data logic → a real Vitest test.
- **Task 4** (Badge variant union) is **type-enforced**: adding `"active"` to the `BadgeVariant` union makes the `Record<BadgeVariant, …>` maps fail `typecheck` until both are updated. `typecheck` _is_ the test there.

Do not add performative tests for the CSS tasks.

## Commits

The repo owner handles commits and may prefer to review before committing. Each phase ends with a **commit checkpoint** you may run _or_ leave staged for them. Commit messages are single-line, no AI attribution (repo convention). Confirm the owner's preference before committing.

## File Structure / Touch Map

**Foundational (one file, do first):**

- `packages/tailwind-config/theme.css` — palette, brand tokens, `::selection`, scrollbars, `.stripes-slanted`

**UI library (`packages/ui/src/components/`):**

- `button.tsx` — on-mint text
- `badge.tsx` — decouple `default`, add `active` variant
- `dialog.tsx`, `menu.tsx`, `select.tsx`, `popover.tsx`, `toast.tsx` — glass

**Console (`apps/console/src/`):**

- `lib/sandbox-utils.ts` + `lib/sandbox-utils.test.ts` — mint "running" mapping
- `components/sandboxes/sandbox-status-hero.tsx` — mint "active" status config
- `components/sidebar/sidebar-nav.tsx` — mint active nav (tint + text + brackets)
- `components/step-indicator.tsx` — on-mint text
- `components/page-header.tsx`, `components/sidebar/sidebar.tsx`, `components/command-palette.tsx` — glass
- sticky table headers in `app/(dashboard)/{sandboxes,api-keys,templates,snapshots,audit-logs}/page.tsx` + `app/(dashboard)/sandboxes/[sandbox_id]/terminal/page.tsx` — glass
- `components/sandboxes/terminal-tabs.tsx` — stripe texture

---

## Phase 1 — Theme Foundation

### Task 1: Palette, brand tokens, and signature extras

**Files:**

- Modify: `packages/tailwind-config/theme.css`

- [ ] **Step 1: Repoint the palette and add brand tokens**

In the `@theme` block, replace this exact run of tokens:

```css
--color-background: #0a0a0a;
--color-foreground: #e5e5e5;
--color-surface: #171717;
--color-surface-hover: #262626;
--color-border: #262626;
--color-border-focus: #525252;
--color-input: #262626;
--color-ring: #404040;
--color-muted: #999999;

--color-primary: #e5e5e5;
--color-primary-hover: #d4d4d4;
```

with:

```css
/* Brand (mint) — the interactive accent */
--color-brand: #b2fab4;
--color-brand-hover: #9de89f;
--color-brand-ink: #0a2b0c;

--color-background: #141414;
--color-foreground: #eaeaea;
--color-surface: #1c1c1c;
--color-surface-hover: #242424;
--color-border: rgba(255, 255, 255, 0.08);
--color-border-strong: rgba(255, 255, 255, 0.12);
--color-border-focus: var(--color-brand);
--color-input: rgba(255, 255, 255, 0.08);
--color-ring: var(--color-brand);
--color-muted: rgba(255, 255, 255, 0.6);

/* primary is the accent; aliased to brand so existing
     bg-primary / text-primary usages become mint in one move */
--color-primary: var(--color-brand);
--color-primary-hover: var(--color-brand-hover);
```

Leave `--color-destructive*`, `--color-success`, `--color-warning`, the `--font-*`, and the `--animate-*` tokens unchanged.

- [ ] **Step 2: Add mint selection + themed scrollbars to the base layer**

Replace the existing `@layer base { … }` block:

```css
@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground text-sm;
  }
}
```

with:

```css
@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground text-sm;
  }

  /* Mint text selection (ported from website) */
  ::selection {
    background-color: color-mix(in srgb, var(--color-brand) 30%, transparent);
    color: var(--color-brand);
  }

  /* Thin themed scrollbars; brighten to mint on hover.
     xterm hides its own scrollbar via a more specific rule in
     apps/console/src/app/globals.css, so this does not regress the terminal. */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
  }
  ::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--color-brand) 50%, transparent);
  }
}
```

- [ ] **Step 3: Append the slanted-stripe utility at the end of the file**

```css
/* Slanted hatch texture for terminal/section headers (ported from website) */
.stripes-slanted {
  background-image: repeating-linear-gradient(
    -45deg,
    transparent 0,
    transparent 6px,
    rgba(255, 255, 255, 0.05) 6px,
    rgba(255, 255, 255, 0.05) 7px
  );
}
```

- [ ] **Step 4: Build the console to verify the theme compiles**

Run: `bunx turbo run build --filter=@superserve/console`
Expected: build succeeds (Tailwind resolves the new tokens and `var()` aliases; no "unknown utility" errors).

- [ ] **Step 5: Visual smoke check**

Run: `bunx turbo run dev --filter=@superserve/console`, open the app.
Expected: background is now charcoal `#141414`; primary buttons are solid mint; links/selected tabs/checked switches are mint; selecting text shows a mint highlight; scrollbar thumb brightens to mint on hover. (On-mint button text looks slightly dark/charcoal — fixed in Task 2.)

- [ ] **Step 6: Commit checkpoint (Phase 1)**

```bash
git add packages/tailwind-config/theme.css
git commit -m "console theme: charcoal canvas, mint brand tokens, mint selection + scrollbars"
```

---

## Phase 2 — On-Mint Contrast & Badge Semantics

### Task 2: Button — dark-green text on the mint fill

`bg-primary` is now mint, but the default button still uses `text-background` (charcoal). Switch the on-mint text to the richer `brand-ink`.

**Files:**

- Modify: `packages/ui/src/components/button.tsx:12`

- [ ] **Step 1: Edit the default variant**

Replace:

```ts
  default: "bg-primary text-background hover:bg-primary-hover",
```

with:

```ts
  default: "bg-primary text-brand-ink hover:bg-primary-hover",
```

Leave `destructive`, `outline`, `ghost`, and `link` unchanged (`link` uses `text-primary`, which is now mint — intended).

- [ ] **Step 2: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/ui`
Expected: PASS (`text-brand-ink` is a valid token from Task 1).

### Task 3: Step indicator — dark-green text on the completed (mint) circle

**Files:**

- Modify: `apps/console/src/components/step-indicator.tsx:35`

- [ ] **Step 1: Edit the completed-circle classes**

Replace:

```ts
          completed
            ? "border-primary bg-primary text-background"
```

with:

```ts
          completed
            ? "border-primary bg-primary text-brand-ink"
```

Leave the `active` branch (`border-primary text-primary`) unchanged — `text-primary` is now mint, which is intended for the active step.

- [ ] **Step 2: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/console`
Expected: PASS.

### Task 4: Badge — keep `default` neutral, add `active` (mint) variant

Repointing `primary` to mint would silently turn every default badge mint. Decouple `default` (neutral labels stay neutral) and add a dedicated `active` variant for the "running" status (Task 5 consumes it).

**Files:**

- Modify: `packages/ui/src/components/badge.tsx`

- [ ] **Step 1: Extend the variant union**

Replace:

```ts
type BadgeVariant = "default" | "success" | "warning" | "destructive" | "muted"
```

with:

```ts
type BadgeVariant =
  | "default"
  | "active"
  | "success"
  | "warning"
  | "destructive"
  | "muted"
```

- [ ] **Step 2: Update the class maps (decouple `default`, add `active`)**

Replace:

```ts
const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted/10 text-muted",
}

const dotColorClasses: Record<BadgeVariant, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted",
}
```

with:

```ts
const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-foreground/10 text-foreground/80",
  active: "bg-brand/10 text-brand",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted/10 text-muted",
}

const dotColorClasses: Record<BadgeVariant, string> = {
  default: "bg-foreground/60",
  active: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted",
}
```

- [ ] **Step 3: Typecheck (this is the test for Tasks 2–4)**

Run: `bunx turbo run typecheck --filter=@superserve/ui --filter=@superserve/console`
Expected: PASS. (If you missed a `Record` entry, TS fails here — that's the exhaustiveness guard.)

- [ ] **Step 4: Lint/format the touched files**

Run: `bunx oxlint --fix && bunx oxfmt --write`
Expected: clean.

- [ ] **Step 5: Commit checkpoint (Phase 2)**

```bash
git add packages/ui/src/components/button.tsx packages/ui/src/components/badge.tsx apps/console/src/components/step-indicator.tsx
git commit -m "console ui: dark-green text on mint fills; neutral default badge + mint active variant"
```

---

## Phase 3 — Status Semantics (mint = "running")

### Task 5: Map the sandbox `active` status to the mint `active` badge

**Files:**

- Modify: `apps/console/src/lib/sandbox-utils.ts:5-10`
- Test: `apps/console/src/lib/sandbox-utils.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/lib/sandbox-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { STATUS_BADGE_VARIANT } from "./sandbox-utils"

describe("STATUS_BADGE_VARIANT", () => {
  it("maps a running sandbox to the mint 'active' badge variant", () => {
    expect(STATUS_BADGE_VARIANT.active).toBe("active")
  })

  it("keeps non-running statuses on their existing variants", () => {
    expect(STATUS_BADGE_VARIANT.paused).toBe("muted")
    expect(STATUS_BADGE_VARIANT.resuming).toBe("warning")
    expect(STATUS_BADGE_VARIANT.failed).toBe("destructive")
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `bunx turbo run test --filter=@superserve/console -- sandbox-utils`
Expected: FAIL — `STATUS_BADGE_VARIANT.active` is currently `"success"`, not `"active"`.

- [ ] **Step 3: Update the mapping**

In `apps/console/src/lib/sandbox-utils.ts`, replace:

```ts
export const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = {
  active: "success",
  paused: "muted",
  resuming: "warning",
  failed: "destructive",
}
```

with:

```ts
export const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = {
  active: "active",
  paused: "muted",
  resuming: "warning",
  failed: "destructive",
}
```

Leave `STATUS_LABEL` and `ACTIVITY_STATUS_VARIANT` unchanged (activity-log "success" stays green — it is a stored outcome, not a live sandbox).

- [ ] **Step 4: Run the test, verify it passes**

Run: `bunx turbo run test --filter=@superserve/console -- sandbox-utils`
Expected: PASS.

### Task 6: Mint the "active" sandbox status hero

**Files:**

- Modify: `apps/console/src/components/sandboxes/sandbox-status-hero.tsx:39-44`

- [ ] **Step 1: Edit the `active` entry of `STATUS_CONFIG`**

Replace:

```ts
  active: {
    label: "Active",
    bg: "bg-success/[0.04]",
    dot: "bg-success",
    pulse: true,
  },
```

with:

```ts
  active: {
    label: "Active",
    bg: "bg-brand/[0.05]",
    dot: "bg-brand",
    pulse: true,
  },
```

Leave `paused`, `resuming`, and `failed` unchanged.

- [ ] **Step 2: Typecheck + visual check**

Run: `bunx turbo run typecheck --filter=@superserve/console`
Expected: PASS. Then in the running app, an active sandbox's status hero + table-row badge read mint; a `ready` template / `saved` snapshot still reads green.

- [ ] **Step 3: Commit checkpoint (Phase 3)**

```bash
git add apps/console/src/lib/sandbox-utils.ts apps/console/src/lib/sandbox-utils.test.ts apps/console/src/components/sandboxes/sandbox-status-hero.tsx
git commit -m "console: mint = running sandbox status; green reserved for ready/saved"
```

---

## Phase 4 — Active/Selected Accent (sidebar)

### Task 7: Mint the active sidebar nav item (tint + text + corner brackets)

The active item currently uses a neutral `bg-foreground/4` fill, `text-foreground`, and default (neutral) corner brackets. Make the active state mint. Leave the **hover** layer neutral (hovering ≠ selected), and leave `corner-brackets.tsx`'s default unchanged so decorative uses elsewhere stay neutral.

**Files:**

- Modify: `apps/console/src/components/sidebar/sidebar-nav.tsx`

- [ ] **Step 1: Mint the active background layer (line ~47-49)**

Replace:

```tsx
{
  isActive && !hoveredHref && (
    <span className="absolute inset-0 bg-foreground/4" />
  )
}
```

with:

```tsx
{
  isActive && !hoveredHref && <span className="absolute inset-0 bg-brand/10" />
}
```

Leave the hovered `motion.span` (`bg-foreground/4`, line ~37-38) unchanged.

- [ ] **Step 2: Mint the active corner brackets (line ~60)**

Replace:

```tsx
<CornerBrackets size="sm" />
```

with:

```tsx
<CornerBrackets size="sm" className="border-brand/50" />
```

- [ ] **Step 3: Mint the active label/icon text (line ~75-77)**

Replace:

```tsx
          isActive
            ? "text-foreground"
            : "text-foreground/70 hover:text-foreground",
```

with:

```tsx
          isActive
            ? "text-brand"
            : "text-foreground/70 hover:text-foreground",
```

- [ ] **Step 4: Typecheck + visual check**

Run: `bunx turbo run typecheck --filter=@superserve/console`
Expected: PASS. The selected sidebar item shows a mint tint, mint icon+label, and mint corner brackets; the sticky-hover animation still works and stays neutral on non-active items.

- [ ] **Step 5: Commit checkpoint (Phase 4)**

```bash
git add apps/console/src/components/sidebar/sidebar-nav.tsx
git commit -m "console sidebar: mint active nav item (tint, text, corner brackets)"
```

---

## Phase 5 — Translucency: UI Library

Pattern: translucent `bg-surface/NN` + `backdrop-blur-*` on surfaces that float over content. Keep dashed borders and shadows.

### Task 8: Frost dialogs, menus, selects, popovers, toasts

**Files:**

- Modify: `packages/ui/src/components/dialog.tsx:56,59`
- Modify: `packages/ui/src/components/menu.tsx:30`
- Modify: `packages/ui/src/components/select.tsx:44`
- Modify: `packages/ui/src/components/popover.tsx:22`
- Modify: `packages/ui/src/components/toast.tsx:155`

- [ ] **Step 1: Dialog backdrop — add blur**

In `dialog.tsx`, replace:

```tsx
<DialogPrimitive.Backdrop className="ss-dialog-backdrop fixed inset-0 z-50 bg-black/50" />
```

with:

```tsx
<DialogPrimitive.Backdrop className="ss-dialog-backdrop fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
```

- [ ] **Step 2: Dialog popup — glass**

In `dialog.tsx`, replace:

```tsx
          "ss-dialog-popup fixed top-1/2 left-1/2 z-50 w-full max-w-md border border-dashed border-border bg-surface shadow-lg",
```

with:

```tsx
          "ss-dialog-popup fixed top-1/2 left-1/2 z-50 w-full max-w-md border border-dashed border-border bg-surface/80 shadow-lg backdrop-blur-xl",
```

- [ ] **Step 3: Menu popup — glass**

In `menu.tsx`, replace:

```tsx
            "ss-menu-popup z-50 min-w-32 border border-dashed border-border bg-surface p-1",
```

with:

```tsx
            "ss-menu-popup z-50 min-w-32 border border-dashed border-border bg-surface/80 p-1 backdrop-blur-xl",
```

- [ ] **Step 4: Select popup — glass**

In `select.tsx`, replace:

```tsx
            "ss-select-popup z-50 max-h-72 min-w-[8rem] overflow-auto border border-dashed border-border bg-surface p-1",
```

with:

```tsx
            "ss-select-popup z-50 max-h-72 min-w-[8rem] overflow-auto border border-dashed border-border bg-surface/80 p-1 backdrop-blur-xl",
```

- [ ] **Step 5: Popover popup — glass**

In `popover.tsx`, replace:

```tsx
            "ss-popover-popup min-w-[8rem] overflow-hidden border border-dashed border-border bg-surface p-4",
```

with:

```tsx
            "ss-popover-popup min-w-[8rem] overflow-hidden border border-dashed border-border bg-surface/80 p-4 backdrop-blur-xl",
```

- [ ] **Step 6: Toast — glass**

In `toast.tsx`, replace:

```tsx
className =
  "pointer-events-auto max-w-[420px] min-w-[320px] border border-dashed border-border bg-surface"
```

with:

```tsx
className =
  "pointer-events-auto max-w-[420px] min-w-[320px] border border-dashed border-border bg-surface/80 backdrop-blur-lg"
```

Leave `tooltip.tsx` solid (tiny, contrast-critical).

- [ ] **Step 7: Typecheck + lint/format**

Run: `bunx turbo run typecheck --filter=@superserve/ui && bunx oxlint --fix && bunx oxfmt --write`
Expected: PASS / clean.

- [ ] **Step 8: Commit checkpoint (Phase 5)**

```bash
git add packages/ui/src/components/dialog.tsx packages/ui/src/components/menu.tsx packages/ui/src/components/select.tsx packages/ui/src/components/popover.tsx packages/ui/src/components/toast.tsx
git commit -m "console ui: frosted-glass dialogs, menus, selects, popovers, toasts"
```

---

## Phase 6 — Translucency: Console

### Task 9: Frost the page header and subtly translucent sidebar

> Note: the `PageHeader` is not a sticky overlay in the current layout, so its blur frosts nothing today — this edit is for visual consistency with the website's translucent header and is harmless/cheap. The real frost-on-scroll happens on the sticky table headers (Task 11).

**Files:**

- Modify: `apps/console/src/components/page-header.tsx:8`
- Modify: `apps/console/src/components/sidebar/sidebar.tsx:30-32` (the root sidebar container with `bg-background`)

- [ ] **Step 1: Page header — translucent + blur**

In `page-header.tsx`, replace:

```tsx
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
```

with:

```tsx
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/70 px-4 backdrop-blur-md">
```

- [ ] **Step 2: Sidebar — subtle translucency**

In `apps/console/src/components/sidebar/sidebar.tsx:31`, replace:

```tsx
        "fixed top-0 left-0 z-40 flex h-screen flex-col border-r border-border bg-background transition-all duration-200",
```

with:

```tsx
        "fixed top-0 left-0 z-40 flex h-screen flex-col border-r border-border bg-background/80 backdrop-blur-sm transition-all duration-200",
```

- [ ] **Step 3: Typecheck**

Run: `bunx turbo run typecheck --filter=@superserve/console`
Expected: PASS.

### Task 10: Frost the command palette

**Files:**

- Modify: `apps/console/src/components/command-palette.tsx:140,148`

- [ ] **Step 1: Backdrop — add blur**

Replace:

```tsx
className = "fixed inset-0 bg-black/50"
```

with:

```tsx
className = "fixed inset-0 bg-black/50 backdrop-blur-sm"
```

- [ ] **Step 2: Popup — glass**

Replace:

```tsx
className =
  "fixed top-[20%] left-1/2 z-50 w-full max-w-lg border border-dashed border-border bg-surface shadow-lg"
```

with:

```tsx
className =
  "fixed top-[20%] left-1/2 z-50 w-full max-w-lg border border-dashed border-border bg-surface/75 shadow-lg backdrop-blur-xl"
```

- [ ] **Step 3: Typecheck + visual check**

Run: `bunx turbo run typecheck --filter=@superserve/console`
Expected: PASS. Open the command palette (Cmd-K) — it floats as frosted glass over the page; the selected item is mint (auto from `primary`/`bg-foreground/5` hover layer).

### Task 11: Frost the sticky table headers + terminal page header

Each of these has the exact substring `sticky top-0 z-10 bg-background`. Replace `bg-background` with `bg-background/70 backdrop-blur-md` in each.

**Files:**

- Modify: `apps/console/src/app/(dashboard)/sandboxes/page.tsx:174`
- Modify: `apps/console/src/app/(dashboard)/api-keys/page.tsx:154`
- Modify: `apps/console/src/app/(dashboard)/templates/page.tsx:145`
- Modify: `apps/console/src/app/(dashboard)/snapshots/page.tsx:97`
- Modify: `apps/console/src/app/(dashboard)/audit-logs/page.tsx:151`
- Modify: `apps/console/src/app/(dashboard)/sandboxes/[sandbox_id]/terminal/page.tsx:63`

- [ ] **Step 1: The five `TableHeader`s**

In each of the five page files above, replace:

```tsx
className = "sticky top-0 z-10 bg-background"
```

with:

```tsx
className = "sticky top-0 z-10 bg-background/70 backdrop-blur-md"
```

- [ ] **Step 2: The terminal page header**

In `terminal/page.tsx:63`, replace:

```tsx
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
```

with:

```tsx
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/70 px-6 backdrop-blur-md">
```

- [ ] **Step 3: Typecheck + visual check**

Run: `bunx turbo run typecheck --filter=@superserve/console`
Expected: PASS. Scroll a long sandboxes/audit-logs table — rows frost as they pass under the sticky header.

- [ ] **Step 4: Lint/format + commit checkpoint (Phase 6)**

```bash
bunx oxlint --fix && bunx oxfmt --write
git add apps/console/src/components/page-header.tsx apps/console/src/components/sidebar/sidebar.tsx apps/console/src/components/command-palette.tsx "apps/console/src/app/(dashboard)"
git commit -m "console: frosted sticky headers, command palette, and subtle sidebar translucency"
```

---

## Phase 7 — Signature Extra: Terminal Stripe Texture

### Task 12: Add the slanted-stripe texture to the terminal tab bar

**Files:**

- Modify: `apps/console/src/components/sandboxes/terminal-tabs.tsx:110`

- [ ] **Step 1: Apply `.stripes-slanted` to the tab bar**

Replace:

```tsx
className =
  "flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-dashed border-border bg-background"
```

with:

```tsx
className =
  "stripes-slanted flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-dashed border-border bg-background"
```

- [ ] **Step 2: Visual check**

Run: `bunx turbo run dev --filter=@superserve/console`, open a sandbox terminal.
Expected: the terminal tab bar shows a faint diagonal hatch. It must NOT also be a frosted page header (that is the separate `terminal/page.tsx:63` element from Task 11).

- [ ] **Step 3: Commit checkpoint (Phase 7)**

```bash
git add apps/console/src/components/sandboxes/terminal-tabs.tsx
git commit -m "console terminal: slanted-stripe texture on tab bar"
```

---

## Phase 8 — Documentation

### Task 13: Update `CLAUDE.md` "Design Language" to match the refresh

**Files:**

- Modify: `CLAUDE.md:243` (Color & Theme paragraph) + insert a Translucency paragraph after the Borders paragraph (`CLAUDE.md:245`)

- [ ] **Step 1: Rewrite the Color & Theme paragraph**

Replace:

```md
**Color & Theme**: Dark monochromatic palette (`#0a0a0a` background, `#e5e5e5` foreground, `#171717` surfaces). Color is reserved for status indicators only (green/red/orange). Tokens are in `packages/tailwind-config/theme.css`.
```

with:

```md
**Color & Theme**: Charcoal canvas (`#141414` background, `#1c1c1c` surfaces, `#eaeaea` foreground) with translucent-white borders (`rgba(255,255,255,0.08)`). The brand accent is **mint** (`--color-brand` `#b2fab4`, hover `#9de89f`, ink `#0a2b0c`), used for interaction and live state: primary buttons, links, active nav, selected tabs, focus rings, checked controls, default progress, and "running" sandbox status. Status colors: mint = running/active, green (`success`) = ready/saved/healthy, amber (`warning`) = building/transitional, red (`destructive`) = failed. `--color-primary` is aliased to `--color-brand`. Tokens are in `packages/tailwind-config/theme.css`.
```

- [ ] **Step 2: Add a Translucency paragraph after the Borders paragraph**

Immediately after the `**Borders**: …` paragraph (line ~245), insert a blank line then:

```md
**Translucency**: Surfaces that float over content use a translucent background + `backdrop-blur` (frosted glass): dialogs, command palette, menus, selects, popovers, toasts, and sticky page/table headers. Body surfaces (cards, table bodies, terminal) stay solid. Used tastefully — not everywhere.
```

- [ ] **Step 3: Verify the section reads correctly**

Run: `grep -n "mint\|charcoal\|Translucency\|monochromatic" CLAUDE.md`
Expected: the new "mint"/"charcoal"/"Translucency" lines are present and there is **no** remaining "monochromatic" / "reserved for status indicators only".

- [ ] **Step 4: Commit checkpoint (Phase 8)**

```bash
git add CLAUDE.md
git commit -m "docs: update Design Language for mint accent, charcoal canvas, glass"
```

---

## Phase 9 — Final Verification

### Task 14: Full repo verification + visual sign-off pass

- [ ] **Step 1: Typecheck, lint, format, unit tests (all)**

```bash
bun run typecheck
bun run lint
bun run format:check
bunx turbo run test --filter=@superserve/console
```

Expected: all green. If `format:check` complains, run `bun run format` and re-stage.

- [ ] **Step 2: Visual checklist against the approved sign-off mockup**

Run `bunx turbo run dev --filter=@superserve/console` and confirm:

- [ ] Background is charcoal `#141414`; surfaces/cards `#1c1c1c`; borders are faint translucent-white.
- [ ] Primary buttons are solid mint with dark-green text; hover darkens to `#9de89f`.
- [ ] Links, selected tabs, checked switches/checkboxes/radios, default progress = mint.
- [ ] Focus an input/select/button → mint focus ring.
- [ ] Sidebar active item = mint tint + mint text + mint corner brackets; non-active hover stays neutral; sticky-hover motion intact.
- [ ] Sandboxes list: an active sandbox row badge + status hero read **mint** ("running"); a `ready` template and `saved` snapshot still read **green**; building = amber; failed = red; paused = neutral.
- [ ] Open a dialog, the command palette (Cmd-K), a dropdown menu, a select → all frosted glass over content.
- [ ] Scroll a long table → rows frost under the sticky table header.
- [ ] Select text → mint highlight. Hover a scrollbar → thumb brightens to mint.
- [ ] Terminal tab bar shows the slanted-stripe hatch.
- [ ] Decorative corner brackets on auth / empty-state / get-started pages remain **neutral** (not minted).

- [ ] **Step 3: Final commit (if anything was re-formatted)**

```bash
git add -A
git commit -m "console: format pass for color refresh"
```

---

## Spec Coverage Map

| Spec section                                                                 | Task(s)                                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| §3 Palette (charcoal, surfaces, translucent borders, brand tokens, muted)    | Task 1                                                    |
| §4 Accent model (buttons, links, selection/active, checked, focus, progress) | Tasks 1, 2, 3, 7 (focus ring via token repoint in Task 1) |
| §5 Status semantics (mint = running; green = ready/saved)                    | Tasks 4, 5, 6                                             |
| §6 Translucency (pop-ups, sticky headers, sidebar)                           | Tasks 8, 9, 10, 11                                        |
| §7 Extras (selection, scrollbars, stripes)                                   | Tasks 1 (selection+scrollbars), 12 (stripes)              |
| §8 Token strategy (repoint primary + surgical fixes)                         | Tasks 1–7                                                 |
| Docs (keep `CLAUDE.md` Design Language accurate)                             | Task 13                                                   |
| §10 A11y/perf, §11 scope, §12 verification                                   | Task 14                                                   |

**Deviation from spec §8:** `corner-brackets.tsx`'s default color is left as the existing `border-foreground/50` (the spec suggested `/40`) to avoid touching a shared default used by decorative brackets; mint is applied at the active call site instead (Task 7). No functional impact.
