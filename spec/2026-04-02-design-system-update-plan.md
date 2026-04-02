# Design System Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Superserve design system to dark mode (neutral palette), Instrument Sans font, and Phosphor icons across the entire monorepo.

**Architecture:** Theme-first cascade — update the central `theme.css` and shared `@superserve/ui` package first, then propagate to each app. Font loading is per-app (Next.js for console, Google Fonts for Vite apps). Icon swap is a find-and-replace per component.

**Tech Stack:** Tailwind CSS v4, React, Next.js (console), Vite (playground, ui-docs), Radix UI, Phosphor Icons, Instrument Sans (Google Fonts)

**Spec:** `spec/2026-04-02-design-system-update.md`

---

### Task 1: Update theme.css — colors and font tokens

**Files:**
- Modify: `packages/tailwind-config/theme.css`

- [ ] **Step 1: Replace theme.css with new dark mode tokens**

Replace the entire contents of `packages/tailwind-config/theme.css`:

```css
@theme {
  --font-sans: var(--sans-font);
  --font-mono: var(--mono-font);

  --color-background: #0a0a0a;
  --color-foreground: #e5e5e5;
  --color-surface: #171717;
  --color-surface-hover: #262626;
  --color-border: #262626;
  --color-border-focus: #158a90;
  --color-input: #262626;
  --color-ring: #105c60;
  --color-muted: #737373;

  --color-primary: #e5e5e5;
  --color-primary-hover: #d4d4d4;

  --color-destructive: oklch(0.55 0.1 25);
  --color-destructive-hover: oklch(0.45 0.1 25);
  --color-success: oklch(0.55 0.08 155);
  --color-warning: oklch(0.6 0.08 75);

  --animate-fade-in: fade-in 0.5s ease-out forwards;
  --animate-accordion-down: accordion-down 0.2s ease-out;
  --animate-accordion-up: accordion-up 0.2s ease-out;
}

@custom-variant dark (&:is(.dark *));

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground text-sm;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes accordion-down {
  from {
    height: 0;
  }
  to {
    height: var(--radix-accordion-content-height);
  }
}

@keyframes accordion-up {
  from {
    height: var(--radix-accordion-content-height);
  }
  to {
    height: 0;
  }
}
```

Changes from current: removed `--font-display`, removed `cream`, `warm-white`, `ink-*`, `auth-border`, `primary-light`, `primary-muted`, `primary-bg`. All semantic colors now map to neutral scale. Status colors are desaturated.

- [ ] **Step 2: Verify file saved correctly**

Run: `cat packages/tailwind-config/theme.css | head -25`
Expected: Should show the new `@theme` block starting with `--font-sans` (no `--font-display`), `--color-background: #0a0a0a`, etc.

- [ ] **Step 3: Commit**

```bash
git add packages/tailwind-config/theme.css
git commit -m "theme: dark mode neutral palette, remove unused tokens"
```

---

### Task 2: Update font loading — Console (Next.js)

**Files:**
- Modify: `apps/console/src/app/layout.tsx`

- [ ] **Step 1: Update the font imports and configuration**

In `apps/console/src/app/layout.tsx`, make these changes:

Replace the import:
```tsx
import { Funnel_Display, Geist_Mono, Inter } from "next/font/google"
```
with:
```tsx
import { Geist_Mono, Instrument_Sans } from "next/font/google"
```

Replace the three font declarations (lines 10-26):
```tsx
const displayFont = Funnel_Display({
  subsets: ["latin"],
  variable: "--display-font",
  display: "swap",
})

const sansFont = Inter({
  subsets: ["latin"],
  variable: "--sans-font",
  display: "swap",
})

const monoFont = Geist_Mono({
  subsets: ["latin"],
  variable: "--mono-font",
  display: "swap",
})
```
with:
```tsx
const sansFont = Instrument_Sans({
  subsets: ["latin"],
  variable: "--sans-font",
  display: "swap",
})

const monoFont = Geist_Mono({
  subsets: ["latin"],
  variable: "--mono-font",
  display: "swap",
})
```

Replace the `className` on `<html>` (lines 62-66):
```tsx
className={cn(
  displayFont.variable,
  sansFont.variable,
  monoFont.variable,
)}
```
with:
```tsx
className={cn(
  sansFont.variable,
  monoFont.variable,
)}
```

Replace the `theme-color` metadata (line 49):
```tsx
"theme-color": "#105C60",
```
with:
```tsx
"theme-color": "#0a0a0a",
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/app/layout.tsx
git commit -m "console: switch to Instrument Sans, remove Funnel Display"
```

---

### Task 3: Update font loading — Playground + UI Docs (Vite apps)

**Files:**
- Modify: `apps/playground/src/index.css`
- Modify: `apps/ui-docs/src/styles/globals.css`
- Modify: `apps/ui-docs/index.html`

- [ ] **Step 1: Update playground CSS variables**

In `apps/playground/src/index.css`, replace the `:root` block (lines 4-8):
```css
:root {
  --sans-font: "Inter", system-ui, -apple-system, sans-serif;
  --mono-font: "Geist Mono", ui-monospace, monospace;
  --display-font: "Inter", system-ui, -apple-system, sans-serif;
}
```
with:
```css
:root {
  --sans-font: "Instrument Sans", system-ui, -apple-system, sans-serif;
  --mono-font: "Geist Mono", ui-monospace, monospace;
}
```

Also update the scrollbar colors (lines 87-91):
```css
::-webkit-scrollbar-thumb {
  background: #d4d4d4;
}
::-webkit-scrollbar-thumb:hover {
  background: #a3a3a3;
}
```
with:
```css
::-webkit-scrollbar-thumb {
  background: #404040;
}
::-webkit-scrollbar-thumb:hover {
  background: #525252;
}
```

- [ ] **Step 2: Update ui-docs CSS variables**

In `apps/ui-docs/src/styles/globals.css`, replace the `:root` block (lines 4-8):
```css
:root {
  --sans-font: "Inter", system-ui, -apple-system, sans-serif;
  --mono-font: "Geist Mono", ui-monospace, monospace;
  --display-font: "Inter", system-ui, -apple-system, sans-serif;
}
```
with:
```css
:root {
  --sans-font: "Instrument Sans", system-ui, -apple-system, sans-serif;
  --mono-font: "Geist Mono", ui-monospace, monospace;
}
```

Also update the scrollbar colors (lines 17-22 and 27):
```css
::-webkit-scrollbar-thumb {
  background: #d4d4d4;
}
::-webkit-scrollbar-thumb:hover {
  background: #a3a3a3;
}
```
with:
```css
::-webkit-scrollbar-thumb {
  background: #404040;
}
::-webkit-scrollbar-thumb:hover {
  background: #525252;
}
```

And the Firefox scrollbar (line 27):
```css
scrollbar-color: #d4d4d4 transparent;
```
with:
```css
scrollbar-color: #404040 transparent;
```

- [ ] **Step 3: Update ui-docs Google Fonts link**

In `apps/ui-docs/index.html`, replace the Google Fonts link (line 8):
```html
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
```
with:
```html
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 4: Update docs.json font references**

In `docs/docs.json`, replace the fonts block (lines 10-18):
```json
"fonts": {
    "heading": {
      "family": "Funnel Display",
      "weight": 600
    },
    "body": {
      "family": "Inter"
    }
  },
```
with:
```json
"fonts": {
    "heading": {
      "family": "Instrument Sans",
      "weight": 600
    },
    "body": {
      "family": "Instrument Sans"
    }
  },
```

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/index.css apps/ui-docs/src/styles/globals.css apps/ui-docs/index.html docs/docs.json
git commit -m "fonts: switch to Instrument Sans across playground, ui-docs, docs"
```

---

### Task 4: Replace font-display class usages in Console

**Files:**
- Modify: `apps/console/src/app/page.tsx` (lines 281, 431)
- Modify: `apps/console/src/app/auth/signup/page.tsx` (lines 104, 124)
- Modify: `apps/console/src/app/auth/signin/page.tsx` (line 144)
- Modify: `apps/console/src/app/auth/forgot-password/page.tsx` (lines 48, 67)
- Modify: `apps/console/src/app/auth/reset-password/page.tsx` (line 66)

- [ ] **Step 1: Replace font-display in page.tsx**

In `apps/console/src/app/page.tsx`:

Line 281 — change:
```tsx
className="font-display text-3xl lg:text-4xl tracking-tight font-semibold mb-2 text-foreground"
```
to:
```tsx
className="text-3xl lg:text-4xl tracking-tight font-semibold mb-2 text-foreground"
```

Line 431 — change:
```tsx
className="font-display text-2xl tracking-tight font-semibold mb-2 text-foreground"
```
to:
```tsx
className="text-2xl tracking-tight font-semibold mb-2 text-foreground"
```

- [ ] **Step 2: Replace font-display in signup/page.tsx**

In `apps/console/src/app/auth/signup/page.tsx`:

Lines 104 and 124 — both contain:
```tsx
className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground"
```
Replace both with:
```tsx
className="text-2xl font-semibold tracking-tight text-center mb-2 text-foreground"
```

- [ ] **Step 3: Replace font-display in signin/page.tsx**

In `apps/console/src/app/auth/signin/page.tsx`:

Line 144 — change:
```tsx
className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground"
```
to:
```tsx
className="text-2xl font-semibold tracking-tight text-center mb-2 text-foreground"
```

- [ ] **Step 4: Replace font-display in forgot-password/page.tsx**

In `apps/console/src/app/auth/forgot-password/page.tsx`:

Lines 48 and 67 — both contain:
```tsx
className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground"
```
Replace both with:
```tsx
className="text-2xl font-semibold tracking-tight text-center mb-2 text-foreground"
```

- [ ] **Step 5: Replace font-display in reset-password/page.tsx**

In `apps/console/src/app/auth/reset-password/page.tsx`:

Line 66 — change:
```tsx
className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground"
```
to:
```tsx
className="text-2xl font-semibold tracking-tight text-center mb-2 text-foreground"
```

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/app/page.tsx apps/console/src/app/auth/signup/page.tsx apps/console/src/app/auth/signin/page.tsx apps/console/src/app/auth/forgot-password/page.tsx apps/console/src/app/auth/reset-password/page.tsx
git commit -m "console: remove font-display class, use font-sans default"
```

---

### Task 5: Swap icon dependencies

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `apps/console/package.json`
- Modify: `apps/ui-docs/package.json`

- [ ] **Step 1: Update package.json files**

In `packages/ui/package.json`, replace in dependencies:
```json
"lucide-react": "^0.575.0",
```
with:
```json
"@phosphor-icons/react": "^2.1.7",
```

In `apps/console/package.json`, replace in dependencies:
```json
"lucide-react": "^0.575.0",
```
with:
```json
"@phosphor-icons/react": "^2.1.7",
```

In `apps/ui-docs/package.json`, replace in dependencies:
```json
"lucide-react": "^0.575.0",
```
with:
```json
"@phosphor-icons/react": "^2.1.7",
```

- [ ] **Step 2: Install dependencies**

Run from repo root:
```bash
bun install
```

Expected: Should complete without errors, `bun.lock` updated.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/package.json apps/console/package.json apps/ui-docs/package.json bun.lock
git commit -m "deps: replace lucide-react with @phosphor-icons/react"
```

---

### Task 6: Migrate icons in packages/ui components

**Files:**
- Modify: `packages/ui/src/components/accordion.tsx`
- Modify: `packages/ui/src/components/alert.tsx`
- Modify: `packages/ui/src/components/breadcrumbs.tsx`
- Modify: `packages/ui/src/components/checkbox.tsx`
- Modify: `packages/ui/src/components/confirm-dialog.tsx`
- Modify: `packages/ui/src/components/dialog.tsx`
- Modify: `packages/ui/src/components/select.tsx`
- Modify: `packages/ui/src/components/toast.tsx`
- Modify: `packages/ui/src/components/button.tsx`

- [ ] **Step 1: Update accordion.tsx**

Replace:
```tsx
import { ChevronDown } from "lucide-react"
```
with:
```tsx
import { CaretDown } from "@phosphor-icons/react"
```

Replace the icon usage (line 37):
```tsx
<ChevronDown className="h-4 w-4 text-muted shrink-0 transition-transform duration-200" />
```
with:
```tsx
<CaretDown className="h-4 w-4 text-muted shrink-0 transition-transform duration-200" weight="light" />
```

- [ ] **Step 2: Update alert.tsx**

Replace:
```tsx
import { AlertTriangle, Check, Info } from "lucide-react"
```
with:
```tsx
import { Warning, Check, Info } from "@phosphor-icons/react"
```

Replace both `AlertTriangle` references in `variantConfig` (lines 20, 25):
```tsx
icon: AlertTriangle,
```
with:
```tsx
icon: Warning,
```

Update the type reference (line 8):
```tsx
{ icon: typeof Info; containerClass: string; iconClass: string }
```
No change needed — `typeof Info` still works with Phosphor's `Info`.

Update the icon rendering (line 57):
```tsx
<Icon className={cn("h-4 w-4 shrink-0 mt-0.5", config.iconClass)} />
```
with:
```tsx
<Icon className={cn("h-4 w-4 shrink-0 mt-0.5", config.iconClass)} weight="light" />
```

- [ ] **Step 3: Update breadcrumbs.tsx**

Replace:
```tsx
import { ChevronRight } from "lucide-react"
```
with:
```tsx
import { CaretRight } from "@phosphor-icons/react"
```

Replace (line 45):
```tsx
{index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted" />}
```
with:
```tsx
{index > 0 && <CaretRight className="h-3.5 w-3.5 text-muted" weight="light" />}
```

- [ ] **Step 4: Update checkbox.tsx**

Replace:
```tsx
import { Check } from "lucide-react"
```
with:
```tsx
import { Check } from "@phosphor-icons/react"
```

Replace (line 34):
```tsx
<Check className="h-3 w-3 text-white" strokeWidth={3} />
```
with:
```tsx
<Check className="h-3 w-3 text-background" weight="bold" />
```

Note: `text-white` → `text-background` (dark text on light primary), and `strokeWidth` → `weight="bold"` for the checkmark to remain visible at small size.

- [ ] **Step 5: Update confirm-dialog.tsx**

Replace:
```tsx
import { AlertTriangle } from "lucide-react"
```
with:
```tsx
import { Warning } from "@phosphor-icons/react"
```

Replace (lines 63-68):
```tsx
<AlertTriangle
  className={cn(
    "h-5 w-5",
    variant === "danger" ? "text-destructive" : "text-warning",
  )}
/>
```
with:
```tsx
<Warning
  className={cn(
    "h-5 w-5",
    variant === "danger" ? "text-destructive" : "text-warning",
  )}
  weight="light"
/>
```

- [ ] **Step 6: Update dialog.tsx**

Replace:
```tsx
import { X } from "lucide-react"
```
with:
```tsx
import { X } from "@phosphor-icons/react"
```

Replace (line 43):
```tsx
<X className="h-4 w-4" />
```
with:
```tsx
<X className="h-4 w-4" weight="light" />
```

- [ ] **Step 7: Update select.tsx**

Replace:
```tsx
import { ChevronsUpDown } from "lucide-react"
```
with:
```tsx
import { CaretUpDown } from "@phosphor-icons/react"
```

Replace (line 28):
```tsx
<ChevronsUpDown className="h-4 w-4 text-muted" />
```
with:
```tsx
<CaretUpDown className="h-4 w-4 text-muted" weight="light" />
```

- [ ] **Step 8: Update toast.tsx**

Replace:
```tsx
import { AlertTriangle, Check, Info, X } from "lucide-react"
```
with:
```tsx
import { Warning, Check, Info, X } from "@phosphor-icons/react"
```

Replace `AlertTriangle` in `variantConfig` (line 123):
```tsx
icon: AlertTriangle,
```
with:
```tsx
icon: Warning,
```

Update icon renderings — line 153:
```tsx
<Icon className={`w-5 h-5 flex-shrink-0 ${config.iconColor}`} />
```
with:
```tsx
<Icon className={`w-5 h-5 flex-shrink-0 ${config.iconColor}`} weight="light" />
```

Line 186:
```tsx
<X className="w-4 h-4" />
```
with:
```tsx
<X className="w-4 h-4" weight="light" />
```

- [ ] **Step 9: Update button.tsx — remove default icon size rule**

In `packages/ui/src/components/button.tsx`, in the `baseClasses` string (line 44), remove this segment:
```
[&_svg:not([class*='size-'])]:size-4
```

The full `baseClasses` becomes:
```tsx
"inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-mono font-medium uppercase transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-border-focus aria-invalid:ring-destructive/20 aria-invalid:border-destructive cursor-pointer"
```

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/components/accordion.tsx packages/ui/src/components/alert.tsx packages/ui/src/components/breadcrumbs.tsx packages/ui/src/components/checkbox.tsx packages/ui/src/components/confirm-dialog.tsx packages/ui/src/components/dialog.tsx packages/ui/src/components/select.tsx packages/ui/src/components/toast.tsx packages/ui/src/components/button.tsx
git commit -m "ui: migrate all components from Lucide to Phosphor icons"
```

---

### Task 7: Migrate icons in apps/console

**Files:**
- Modify: `apps/console/src/app/auth/signup/page.tsx`
- Modify: `apps/console/src/app/auth/signin/page.tsx`
- Modify: `apps/console/src/app/auth/reset-password/page.tsx`
- Modify: `apps/console/src/components/step-indicator.tsx`
- Modify: `apps/console/src/components/code-block.tsx`

- [ ] **Step 1: Update signup/page.tsx icons**

Replace:
```tsx
import { Eye, EyeOff } from "lucide-react"
```
with:
```tsx
import { Eye, EyeSlash } from "@phosphor-icons/react"
```

Replace all `<EyeOff size={18} />` with `<EyeSlash className="size-[18px]" weight="light" />` (lines 158, 177).
Replace all `<Eye size={18} />` with `<Eye className="size-[18px]" weight="light" />` (lines 158, 179).

- [ ] **Step 2: Update signin/page.tsx icons**

Replace:
```tsx
import { Eye, EyeOff } from "lucide-react"
```
with:
```tsx
import { Eye, EyeSlash } from "@phosphor-icons/react"
```

Replace `<EyeOff size={18} />` with `<EyeSlash className="size-[18px]" weight="light" />` (line 172).
Replace `<Eye size={18} />` with `<Eye className="size-[18px]" weight="light" />` (line 172).

- [ ] **Step 3: Update reset-password/page.tsx icons**

Replace:
```tsx
import { Eye, EyeOff } from "lucide-react"
```
with:
```tsx
import { Eye, EyeSlash } from "@phosphor-icons/react"
```

Replace all `<EyeOff size={18} />` with `<EyeSlash className="size-[18px]" weight="light" />` (lines 86, 103).
Replace all `<Eye size={18} />` with `<Eye className="size-[18px]" weight="light" />` (lines 86, 105).

- [ ] **Step 4: Update step-indicator.tsx**

Replace:
```tsx
import { Check } from "lucide-react"
```
with:
```tsx
import { Check } from "@phosphor-icons/react"
```

Replace (line 40):
```tsx
{completed ? <Check className="h-3.5 w-3.5" /> : step}
```
with:
```tsx
{completed ? <Check className="h-3.5 w-3.5" weight="bold" /> : step}
```

- [ ] **Step 5: Update code-block.tsx**

Replace:
```tsx
import { Check, Copy } from "lucide-react"
```
with:
```tsx
import { Check, Copy } from "@phosphor-icons/react"
```

Replace (line 41):
```tsx
<Check className="h-4 w-4 text-emerald-400" />
```
with:
```tsx
<Check className="h-4 w-4 text-emerald-400" weight="light" />
```

Replace (line 43):
```tsx
<Copy className="h-4 w-4" />
```
with:
```tsx
<Copy className="h-4 w-4" weight="light" />
```

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/app/auth/signup/page.tsx apps/console/src/app/auth/signin/page.tsx apps/console/src/app/auth/reset-password/page.tsx apps/console/src/components/step-indicator.tsx apps/console/src/components/code-block.tsx
git commit -m "console: migrate all icons from Lucide to Phosphor"
```

---

### Task 8: Migrate icons in apps/ui-docs

**Files:**
- Modify: `apps/ui-docs/src/components/layout/sidebar.tsx`
- Modify: `apps/ui-docs/src/components/example-preview.tsx`
- Modify: `apps/ui-docs/src/components/code-block.tsx`

- [ ] **Step 1: Update sidebar.tsx**

Replace:
```tsx
import { Menu, X } from "lucide-react"
```
with:
```tsx
import { List, X } from "@phosphor-icons/react"
```

Replace (line 85):
```tsx
{open ? <X className="size-4" /> : <Menu className="size-4" />}
```
with:
```tsx
{open ? <X className="size-4" weight="light" /> : <List className="size-4" weight="light" />}
```

- [ ] **Step 2: Update example-preview.tsx**

Replace:
```tsx
import { Code, X } from "lucide-react"
```
with:
```tsx
import { Code, X } from "@phosphor-icons/react"
```

Replace (lines 19-23):
```tsx
{showCode ? (
  <X className="size-3.5" />
) : (
  <Code className="size-3.5" />
)}
```
with:
```tsx
{showCode ? (
  <X className="size-3.5" weight="light" />
) : (
  <Code className="size-3.5" weight="light" />
)}
```

- [ ] **Step 3: Update code-block.tsx**

Replace:
```tsx
import { Check, Copy } from "lucide-react"
```
with:
```tsx
import { Check, Copy } from "@phosphor-icons/react"
```

Replace (lines 67-69):
```tsx
{copied ? (
  <Check className="size-3.5" />
) : (
  <Copy className="size-3.5" />
)}
```
with:
```tsx
{copied ? (
  <Check className="size-3.5" weight="light" />
) : (
  <Copy className="size-3.5" weight="light" />
)}
```

- [ ] **Step 4: Commit**

```bash
git add apps/ui-docs/src/components/layout/sidebar.tsx apps/ui-docs/src/components/example-preview.tsx apps/ui-docs/src/components/code-block.tsx
git commit -m "ui-docs: migrate all icons from Lucide to Phosphor"
```

---

### Task 9: Fix text contrast for dark mode

**Files:**
- Modify: `packages/ui/src/components/button.tsx`
- Modify: `packages/ui/src/components/tooltip.tsx`
- Modify: `apps/console/src/components/step-indicator.tsx`
- Modify: `apps/console/src/app/auth/signup/page.tsx`
- Modify: `apps/console/src/app/auth/signin/page.tsx`
- Modify: `apps/console/src/app/auth/forgot-password/page.tsx`
- Modify: `apps/console/src/app/auth/reset-password/page.tsx`
- Modify: `apps/console/src/components/code-block.tsx`

- [ ] **Step 1: Fix button.tsx variants**

In `packages/ui/src/components/button.tsx`, update the variant classes:

Replace:
```tsx
default: "bg-primary text-white hover:bg-primary-hover",
```
with:
```tsx
default: "bg-primary text-background hover:bg-primary-hover",
```

Replace:
```tsx
destructive:
  "bg-destructive text-white hover:bg-destructive-hover focus-visible:ring-destructive/20",
```
with:
```tsx
destructive:
  "bg-destructive text-foreground hover:bg-destructive-hover focus-visible:ring-destructive/20",
```

- [ ] **Step 2: Fix tooltip.tsx**

In `packages/ui/src/components/tooltip.tsx`, replace (line 20):
```tsx
"z-50 bg-foreground text-white px-2 py-1 text-xs",
```
with:
```tsx
"z-50 bg-foreground text-background px-2 py-1 text-xs",
```

- [ ] **Step 3: Fix step-indicator.tsx**

In `apps/console/src/components/step-indicator.tsx`, replace (line 34):
```tsx
"bg-primary border-primary text-white"
```
with:
```tsx
"bg-primary border-primary text-background"
```

- [ ] **Step 4: Fix auth button text-white — all auth pages**

In each of these files, replace all occurrences of:
```tsx
className="w-full h-auto py-3.5 bg-primary text-white hover:bg-primary-hover duration-300"
```
with:
```tsx
className="w-full h-auto py-3.5 bg-primary text-background hover:bg-primary-hover duration-300"
```

Files and locations:
- `apps/console/src/app/auth/signup/page.tsx` (line 187)
- `apps/console/src/app/auth/signin/page.tsx` (line 187, line 238)
- `apps/console/src/app/auth/forgot-password/page.tsx` (line 85)
- `apps/console/src/app/auth/reset-password/page.tsx` (line 113)

- [ ] **Step 5: Update code-block.tsx colors for dark mode consistency**

In `apps/console/src/components/code-block.tsx`, the code block already uses a dark background `bg-[#09090b]` which matches the new dark theme. Update the text opacity classes to use `foreground` token:

Replace:
```tsx
<code className="flex-1 text-sm font-mono text-white/80 overflow-x-auto">
  <span className="text-white/70 mr-2 select-none">$</span>
```
with:
```tsx
<code className="flex-1 text-sm font-mono text-foreground/80 overflow-x-auto">
  <span className="text-foreground/70 mr-2 select-none">$</span>
```

Replace:
```tsx
className="ml-3 text-white/40 hover:text-white/80 transition-colors shrink-0"
```
with:
```tsx
className="ml-3 text-muted hover:text-foreground transition-colors shrink-0"
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/button.tsx packages/ui/src/components/tooltip.tsx apps/console/src/components/step-indicator.tsx apps/console/src/app/auth/signup/page.tsx apps/console/src/app/auth/signin/page.tsx apps/console/src/app/auth/forgot-password/page.tsx apps/console/src/app/auth/reset-password/page.tsx apps/console/src/components/code-block.tsx
git commit -m "fix text contrast for dark mode across UI and console"
```

---

### Task 10: Replace removed token usages

**Files:**
- Modify: `apps/playground/src/components/MessageInput.tsx`
- Modify: `apps/playground/src/components/MessageBubble.tsx`
- Modify: `apps/playground/src/components/Sidebar.tsx`
- Modify: `apps/playground/src/components/EmptyState.tsx`
- Modify: `apps/playground/src/pages/AgentsPage.tsx`
- Modify: `apps/playground/src/pages/ChatPage.tsx`
- Modify: `apps/ui-docs/src/pages/component-page.tsx`

- [ ] **Step 1: Update MessageInput.tsx**

Replace (line 89):
```tsx
className="m-2 cursor-pointer bg-primary-bg px-5 py-1.5 font-mono text-xs uppercase tracking-wider text-primary transition-colors hover:bg-primary-muted disabled:cursor-not-allowed disabled:opacity-50"
```
with:
```tsx
className="m-2 cursor-pointer bg-surface-hover px-5 py-1.5 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
```

- [ ] **Step 2: Update MessageBubble.tsx**

Replace (line 188):
```tsx
<span className="text-ink-faint">
```
with:
```tsx
<span className="text-muted">
```

- [ ] **Step 3: Update Sidebar.tsx**

Line 69 — replace:
```tsx
className="px-4 pt-4 pb-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint"
```
with:
```tsx
className="px-4 pt-4 pb-1 font-mono text-[10px] uppercase tracking-widest text-muted"
```

Line 94 — replace:
```tsx
className={`truncate text-[13px] ${isActive ? "font-medium text-foreground" : "text-ink"}`}
```
with:
```tsx
className={`truncate text-[13px] ${isActive ? "font-medium text-foreground" : "text-muted"}`}
```

Line 123 — replace:
```tsx
"text-ink-faint opacity-0 hover:text-ink-light group-hover:opacity-100"
```
with:
```tsx
"text-muted opacity-0 hover:text-foreground group-hover:opacity-100"
```

- [ ] **Step 4: Update EmptyState.tsx**

Line 47 — replace:
```tsx
className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-hover text-ink-muted"
```
with:
```tsx
className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-hover text-muted"
```

- [ ] **Step 5: Update AgentsPage.tsx**

Line 62 — replace:
```tsx
<span className="text-ink-faint">/</span>
```
with:
```tsx
<span className="text-muted">/</span>
```

Line 177 — replace:
```tsx
className="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
```
with:
```tsx
className="shrink-0 text-neutral-600 transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
```

- [ ] **Step 6: Update ChatPage.tsx**

Line 112 — replace:
```tsx
className="cursor-pointer p-1.5 text-muted transition-colors hover:text-ink md:hidden"
```
with:
```tsx
className="cursor-pointer p-1.5 text-muted transition-colors hover:text-foreground md:hidden"
```

Line 132 — replace:
```tsx
<span className="hidden text-ink-faint md:inline">/</span>
```
with:
```tsx
<span className="hidden text-muted md:inline">/</span>
```

Line 136 — replace:
```tsx
className="cursor-pointer text-muted transition-colors hover:text-ink-light"
```
with:
```tsx
className="cursor-pointer text-muted transition-colors hover:text-foreground"
```

Line 140 — replace:
```tsx
<span className="text-ink-faint">/</span>
```
with:
```tsx
<span className="text-muted">/</span>
```

- [ ] **Step 7: Update component-page.tsx**

Line 27 — replace:
```tsx
className="text-primary-light underline underline-offset-2"
```
with:
```tsx
className="text-primary underline underline-offset-2"
```

Line 42 — replace:
```tsx
<code className="text-primary-light">{meta.source}</code>
```
with:
```tsx
<code className="text-primary">{meta.source}</code>
```

- [ ] **Step 8: Commit**

```bash
git add apps/playground/src/components/MessageInput.tsx apps/playground/src/components/MessageBubble.tsx apps/playground/src/components/Sidebar.tsx apps/playground/src/components/EmptyState.tsx apps/playground/src/pages/AgentsPage.tsx apps/playground/src/pages/ChatPage.tsx apps/ui-docs/src/pages/component-page.tsx
git commit -m "replace removed token usages with neutral equivalents"
```

---

### Task 11: Build and typecheck

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck
```

Expected: No TypeScript errors. If there are errors, they'll likely be from Phosphor icon imports (different export names). Fix any import issues.

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

Expected: No lint errors. Fix any issues.

- [ ] **Step 3: Run build**

```bash
bun run build
```

Expected: All packages build successfully. Fix any build errors — most likely causes are:
- Missing Phosphor icon names (check import names match the `@phosphor-icons/react` exports)
- Removed CSS tokens still referenced somewhere (search for the token name and replace)

- [ ] **Step 4: Run tests**

```bash
bun run test
```

Expected: All existing tests pass.

- [ ] **Step 5: Commit any fixes**

If any fixes were needed:
```bash
git add -A
git commit -m "fix build/typecheck issues from design system migration"
```
