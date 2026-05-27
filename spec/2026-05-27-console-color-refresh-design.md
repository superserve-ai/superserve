# Console Color & Surface Refresh — Design

**Date:** 2026-05-27
**Branch:** `jeet/console-ui-design-update`
**Status:** Approved (design); pending implementation plan

## 1. Background & Goals

The marketing **website** (`/website`) has moved to a refined design language: a warmer
charcoal canvas, faint translucent-white borders, a **mint-green brand accent**
(`#b2fab4`), and tasteful frosted-glass surfaces. The **console** (`apps/console`) is
its sibling — same fonts (Instrument Sans + Geist Mono), same mono-uppercase labels,
same sharp corners, same dashed borders, same `CornerBrackets` motif — but it is still
fully **monochrome** on a near-black canvas with solid gray borders and no brand accent.

**Goal:** bring the console's color and surface treatment in line with the website,
_tastefully_, without disturbing what already works.

**Explicitly preserved (non-negotiable):**

- Layout (collapsible sidebar, `PageHeader` h-14 → toolbar → scrollable content, settings two-column grid)
- Motion (scale-based dialog/popover transitions, `layoutId` sticky-hover on nav/tabs/rows/command-palette)
- Cleanliness / austere density — **no** decorative glow, no visual noise
- Sharp corners, dashed borders, and the `CornerBrackets` motif
- The status palette's _meaning_ (green/amber/red still communicate state)

## 2. Design Decisions (settled during brainstorming)

Three pillars, each chosen by the user against live mockups:

1. **Accent — Mint-forward.** Mint owns selection & live state (active nav, selected
   tabs, focus rings, links, checked toggles, progress) **and** primary action buttons
   become solid mint (like the website CTA).
2. **Canvas — Charcoal (website match).** Background `#141414`, surfaces `#1c1c1c`,
   borders become faint translucent-white. Full cohesion with the marketing site.
3. **Translucency — Tasteful tier.** Glass on true pop-ups (dialogs, command palette,
   menus, popovers) **plus** the things content scrolls under (sticky page header,
   sticky table headers) **plus** a subtle sidebar translucency. Nothing more.

Plus two refinements:

4. **Status semantics — "mint = running".** Mint is the brand's "alive" signal: a
   **running/active** sandbox uses mint. Plain green is reserved for _stored_ success
   ("ready" templates, "saved" snapshots). Amber = building/transitional, red = failed,
   translucent-white = paused.
5. **Signature extras (folded in):** mint text-selection, themed thin scrollbars,
   slanted-stripe texture on terminal/section headers. **No mint glow** (kept flat).

## 3. The Palette

All tokens live in `packages/tailwind-config/theme.css` (`@theme` block + `:root`-style
vars). Before → after:

| Token                   | Now                   | After                          | Notes                     |
| ----------------------- | --------------------- | ------------------------------ | ------------------------- |
| `--color-background`    | `#0a0a0a`             | **`#141414`**                  | warmer charcoal (website) |
| `--color-foreground`    | `#e5e5e5`             | **`#eaeaea`**                  | align to website ink      |
| `--color-surface`       | `#171717`             | **`#1c1c1c`**                  | elevated cards/popups     |
| `--color-surface-hover` | `#262626`             | **`#242424`**                  |                           |
| `--color-border`        | `#262626` (solid)     | **`rgba(255,255,255,0.08)`**   | translucent white         |
| `--color-border-strong` | — (new)               | **`rgba(255,255,255,0.12)`**   | stronger dividers         |
| `--color-border-focus`  | `#525252`             | **`var(--color-brand)`**       | focus turns mint          |
| `--color-input`         | `#262626`             | **`rgba(255,255,255,0.08)`**   |                           |
| `--color-ring`          | `#404040`             | **`var(--color-brand)`**       | mint focus ring           |
| `--color-muted`         | `#999999`             | **`rgba(255,255,255,0.60)`**   | website muted ink         |
| `--color-primary`       | `#e5e5e5`             | **`var(--color-brand)`**       | accent ⇒ mint (see §8)    |
| `--color-primary-hover` | `#d4d4d4`             | **`var(--color-brand-hover)`** |                           |
| `--color-brand`         | — (new)               | **`#b2fab4`**                  | mint                      |
| `--color-brand-hover`   | — (new)               | **`#9de89f`**                  |                           |
| `--color-brand-ink`     | — (new)               | **`#0a2b0c`**                  | dark text _on_ mint       |
| `--color-success`       | `oklch(0.6 0.15 155)` | **keep**                       | stored/healthy green      |
| `--color-warning`       | `oklch(0.65 0.14 75)` | **keep**                       | amber                     |
| `--color-destructive`   | `oklch(0.5 0.18 12)`  | **keep**                       | red                       |

`success` stays a deeper, saturated green; mint is pastel/light. With the semantic split
(§5) the two greens never compete for the same meaning, and they read distinctly against
charcoal (verified in mockup).

## 4. Accent Model (how mint is applied)

Mint appears in exactly these roles. Everything else stays neutral foreground/muted.

- **Primary buttons** — solid `bg-brand` + `text-brand-ink` (dark green), hover `bg-brand-hover`.
- **Links / link-buttons** — `text-brand`, underline on hover.
- **Selection & active state** — active sidebar nav (mint tint `bg-brand/10` + mint
  text + mint `CornerBrackets`), selected tabs (mint underline + mint label), selected
  command-palette / menu items (mint tint).
- **Form controls (checked)** — switch, checkbox, radio checked = `bg-brand` / `border-brand`.
- **Focus rings** — `ring-brand` (via `border-focus`/`ring` repoint) across inputs,
  selects, buttons, etc.
- **Progress (default variant)** — `bg-brand`.
- **Text selection** — `::selection` mint tint (§7).

**Restraint:** action buttons are the only large mint fills; mint elsewhere is text,
1px brackets/underlines, or ≤10%-opacity tints. This keeps the mint-forward direction
from becoming loud.

## 5. Status Semantics

Mint takes over _one_ status — the live one — and the existing palette keeps the rest.

| State                                           | Where                                        | Color after                             |
| ----------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| **Running / active** sandbox                    | sandbox status hero, sandbox table row badge | **mint** (`brand`)                      |
| Resuming / building / snapshotting              | sandbox, templates                           | amber (`warning`) — unchanged           |
| Failed                                          | sandbox, templates                           | red (`destructive`) — unchanged         |
| Paused                                          | sandbox                                      | translucent-white / `muted` — unchanged |
| **Ready** template, **saved** snapshot, healthy | templates, snapshots                         | **green** (`success`) — unchanged       |

Implementation touch-points:

- **`packages/ui/src/components/badge.tsx`** — add an **`active`** variant
  (`bg-brand/10 text-brand`, dot `bg-brand`). Decouple the existing **`default`** variant
  from `primary` so generic labels stay neutral (`bg-foreground/10 text-foreground/80`)
  rather than silently turning mint when `primary` is repointed (§8).
- **`apps/console/src/lib/sandbox-utils.ts`** (`STATUS_BADGE_VARIANT`) — map sandbox
  `active` → `active` (mint). Leave `resuming`/`failed`/`paused` as-is.
- **`apps/console/src/components/sandboxes/sandbox-status-hero.tsx`** (`STATUS_CONFIG`) —
  `active` → `bg-brand/[0.05]` + dot `bg-brand` (keep `pulse`).
- **Templates/snapshots** (`template-status-badge.tsx`, `snapshots-section.tsx`) — no
  change; `ready`/`saved` keep `success` green.

## 6. Translucency Model (tasteful tier)

Add `backdrop-blur` + a translucent background only where it earns its keep. Pattern
mirrors the website's header (`bg-background/90 backdrop-blur-md`).

| Surface                                       | File                                                                                                    | Before → After                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Page header (h-14, sticky)                    | `apps/console/src/components/page-header.tsx`                                                           | `bg-background` → `bg-background/70 backdrop-blur-md`                                  |
| Sticky table headers + terminal _page_ header | sandboxes / api-keys / templates / snapshots / audit-logs pages; `terminal/page.tsx` h-14 sticky header | `bg-background` → `bg-background/70 backdrop-blur-md`                                  |
| Sidebar                                       | `apps/console/src/components/sidebar/sidebar.tsx`                                                       | `bg-background` → `bg-background/80 backdrop-blur-sm` (subtle)                         |
| Dialog backdrop                               | `packages/ui/src/components/dialog.tsx`                                                                 | `bg-black/50` → `bg-black/50 backdrop-blur-sm`                                         |
| Dialog popup                                  | `dialog.tsx`                                                                                            | `bg-surface` → `bg-surface/80 backdrop-blur-xl`                                        |
| Command palette popup + backdrop              | `apps/console/src/components/command-palette.tsx`                                                       | popup `bg-surface` → `bg-surface/75 backdrop-blur-xl`; backdrop add `backdrop-blur-sm` |
| Menu / Select / Popover popups                | `packages/ui/src/components/{menu,select,popover}.tsx`                                                  | `bg-surface` → `bg-surface/80 backdrop-blur-xl`                                        |
| Toast                                         | `packages/ui/src/components/toast.tsx`                                                                  | `bg-surface` → `bg-surface/80 backdrop-blur-lg`                                        |

**Kept solid:** tooltips (tiny, contrast-critical), cards/panels, table bodies, terminal
body. (Generous-tier glass was explicitly rejected.)

## 7. Signature Extras

Ported from the website, added to `theme.css` base layer / utilities:

- **Mint text selection** — `::selection { background: color-mix(in srgb, var(--color-brand) 30%, transparent); color: var(--color-brand); }`
- **Themed scrollbars** — thin (`8px`) webkit scrollbars, transparent track, translucent
  thumb (`rgba(255,255,255,0.10)`) brightening to mint on hover. Must **not** regress the
  existing xterm scrollbar hiding in `apps/console/src/app/globals.css`.
- **Slanted-stripe texture** — port `.stripes-slanted`
  (`repeating-linear-gradient(-45deg, …, rgba(255,255,255,0.05) …)`); apply to the
  terminal _panel / tab-bar_ header (`terminal.tsx` / `terminal-tabs.tsx`) — a different
  element from the frosted _page_ header in §6, so the two never stack — and optionally
  section eyebrows. Cosmetic only.

## 8. Token Architecture & Strategy

The console's token design makes this refresh mostly a **token operation**, not a
sweeping component rewrite:

1. **Add brand tokens** (`--color-brand`, `--color-brand-hover`, `--color-brand-ink`).
2. **Repoint `--color-primary` → `var(--color-brand)`.** This single change flips ~80%
   of the accent surface to mint at once, because `primary` already backs: default
   button, link button, selected tab border, checked switch/checkbox/radio, default
   progress, toast info/action, step indicator, device-code text. All of these _should_
   be mint under the mint-forward decision — verified against the agent inventory; no
   `primary` usage needs to stay gray.
3. **Targeted fixes the repoint can't cover:**
   - **Text on mint:** default `Button` uses `bg-primary text-background`; change the
     on-mint text to `text-brand-ink` (richer dark green). Same for the completed
     `step-indicator` circle.
   - **Badge `default`:** decouple from `primary` so neutral labels don't turn mint;
     add the `active` mint variant (§5).
   - **`border-focus` / `ring` → brand** for mint focus rings.
   - **`CornerBrackets`:** keep the component default neutral
     (`border-foreground/40`); pass `border-brand/50` at the _active/selected_ call
     sites (sidebar nav active, selected tabs). Decorative uses (auth, empty states,
     get-started) stay neutral to avoid over-minting.
4. **Canvas + borders** are pure token edits (background/surface/border values).
5. **Translucency + extras** are localized class edits per §6/§7.

This ordering means the canvas/accent land in one theme edit, then a short list of
surgical component edits handles contrast, status semantics, and glass.

## 9. Affected Files (inventory)

**Theme (foundational):**

- `packages/tailwind-config/theme.css` — palette, brand tokens, `::selection`, scrollbars, `.stripes-slanted`

**UI library (`packages/ui/src/components/`):**

- `button.tsx` (on-mint text), `badge.tsx` (decouple default + add `active`),
  `dialog.tsx`, `menu.tsx`, `select.tsx`, `popover.tsx`, `toast.tsx` (translucency)
- Focus-ring repoint is centralized via tokens; verify `input.tsx`, `textarea.tsx`,
  `tabs.tsx`, `switch.tsx`, `checkbox.tsx`, `radio.tsx` render correctly after.

**Console app (`apps/console/src/`):**

- `components/corner-brackets.tsx` (default color), `components/sidebar/sidebar.tsx`
  - `sidebar-nav.tsx` (translucency + active mint brackets),
    `components/page-header.tsx` (frosted), `components/command-palette.tsx` (frosted),
    `components/step-indicator.tsx` (on-mint text),
    `components/sandboxes/sandbox-status-hero.tsx` + `lib/sandbox-utils.ts` (mint running),
    `components/sandboxes/terminal*.tsx` (stripe header + frosted sticky header),
    sticky table headers across `app/(dashboard)/{sandboxes,api-keys,templates,snapshots,audit-logs}` pages.

(The implementation plan will enumerate exact lines.)

## 10. Accessibility & Performance

- **Contrast:** mint `#b2fab4` on charcoal `#141414` ≈ 12:1 (well past AA). Brand-ink
  `#0a2b0c` on mint ≈ 9:1 (passes). Mint `/10` tints carry no text contrast load (text
  is full-opacity mint/foreground over charcoal).
- **Focus visibility:** mint ring is higher-contrast than today's gray `border-focus` —
  a net a11y win. Keep ring width ≥ 2px.
- **Blur performance:** glass is confined to small/occasional surfaces. The only
  blur-over-scrolling-content cases are the sticky page header and sticky table header
  _rows_ (small repaint area). Avoid blurring large always-on regions (table bodies,
  cards) — already excluded.
- **Reduced transparency:** acceptable to leave translucency unconditional for v1; a
  `prefers-reduced-transparency` fallback is a possible follow-up, not in scope.

## 11. Scope / Non-Goals

- **In scope:** color tokens, brand accent, charcoal canvas, translucent borders,
  tasteful glass, mint-running status, the three signature extras.
- **Out of scope / non-goals:**
  - No layout, spacing, or motion changes.
  - No light theme (console is dark-only; confirmed no light/`prefers-color-scheme`).
  - No mint glow / radial gradients (kept flat & clean, per user).
  - No generous-tier glass (cards, table bodies, full sidebar opacity stay solid).
  - No changes to the website or shared SDK/CLI.
  - No new dependencies.

## 12. Verification

- `bun run typecheck`, `bun run lint`, `bun run format:check` clean.
- Existing console tests (Vitest) pass; update any snapshot/class assertions touching
  changed tokens.
- Manual visual pass in the running console (`bun run dev`) against the approved
  sign-off mockup: sandboxes list (mint running rows, frosted sticky header + table
  header), a dialog + command palette (glass), focus an input (mint ring), open the
  terminal (stripe header), select text (mint highlight), hover the scrollbar (mint).
- Confirm green still reads as "ready/saved" on templates & snapshots, distinct from
  mint "running".
- Spot-check the get-started / auth / empty-state pages for unintended mint on
  decorative corner brackets.
