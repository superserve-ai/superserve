# Design System Update: Dark Mode, Instrument Sans, Phosphor Icons

## Summary

Update the Superserve design system across the entire monorepo:

1. **Font:** Replace Funnel Display and Inter with Instrument Sans. Collapse `font-display` into `font-sans`. Keep Geist Mono.
2. **Colors:** Dark mode, monochromatic, based on Tailwind `neutral` scale. Keep a swappable accent color. Muted status colors. Simplify the custom CSS variable system.
3. **Icons:** Migrate from Lucide React to Phosphor Icons (Light weight, className-based sizing).
4. **Style:** Flat, non-rounded, dashed borders — unchanged.

## Approach

Theme-first cascade. Update the shared foundation (`tailwind-config/theme.css`, `@superserve/ui`) first, then let changes cascade to apps. Each app only needs font loading updates and targeted icon/class fixes.

Order: theme tokens → font loading → UI component icon swap → app-level sweep.

---

## 1. Color System

### New theme tokens

All semantic tokens map to Tailwind `neutral` scale values. The custom oklch/hex values are replaced with standard neutral shades.

```
background     → neutral-950  (#0a0a0a)     Darkest background
foreground     → neutral-200  (#e5e5e5)     Primary text
surface        → neutral-900  (#171717)     Cards, dialogs, inputs
surface-hover  → neutral-800  (#262626)     Hover states
border         → neutral-800  (#262626)     Dashed borders
border-focus   → accent color               Focus rings
input          → neutral-800  (#262626)     Input backgrounds
ring           → accent color               Focus ring
muted          → neutral-500  (#737373)     Secondary text
primary        → neutral-200  (#e5e5e5)     Primary buttons/actions
primary-hover  → neutral-300  (#d4d4d4)     Primary hover
```

### Accent color

Kept as a single pair of tokens (`border-focus`, `ring`). Defaults:
- `border-focus` → `#158a90` (teal, unchanged)
- `ring` → `#105c60` (teal, unchanged)

To swap the accent, change these two values. Everything else is neutral.

### Button text contrast

Since `primary` is now a light color (neutral-200), button text flips from `text-white` to `text-neutral-950` for contrast. Similarly, `text-primary` link styling now renders as light text on dark backgrounds — correct for dark mode. The tooltip component also inverts: currently `bg-foreground text-white` → becomes `bg-foreground text-background` (light bg, dark text).

### Status colors (desaturated for dark mode)

```
destructive       → oklch(0.55 0.1 25)      Muted red
destructive-hover → oklch(0.45 0.1 25)      Darker muted red
success           → oklch(0.55 0.08 155)     Muted green
warning           → oklch(0.6 0.08 75)       Muted amber
```

### Removed tokens

These are no longer needed in a monochromatic dark scheme. Replace usages with direct `neutral-*` classes or existing semantic tokens:

- `cream`, `warm-white` → use `background` or `surface`
- `ink`, `ink-light`, `ink-muted`, `ink-faint` → use `foreground`, `muted`, or direct `neutral-*`
- `auth-border` → use `border`
- `primary-light`, `primary-muted`, `primary-bg` → remove, use `primary` with opacity or `surface-hover`

### Scrollbar colors

Playground and UI Docs hardcoded scrollbar colors update from light grays to dark neutrals:
- Thumb: `neutral-700` (#404040)
- Thumb hover: `neutral-600` (#525252)

### Console metadata

`theme-color` in layout.tsx updates from `#105C60` to `#0a0a0a` (matches background).

---

## 2. Font System

### Token changes

Remove `--font-display`. Keep `--font-sans` and `--font-mono`.

```css
--font-sans: var(--sans-font);
--font-mono: var(--mono-font);
```

### Font loading by app

**Console (`apps/console/src/app/layout.tsx`):**
- Replace `import { Funnel_Display, Geist_Mono, Inter } from "next/font/google"` with `import { Instrument_Sans, Geist_Mono } from "next/font/google"`
- Remove `displayFont` variable and its CSS variable assignment
- `sansFont` → Instrument_Sans config with `--sans-font` variable

**Playground (`apps/playground/src/index.css`):**
- `--sans-font: "Instrument Sans", system-ui, -apple-system, sans-serif;`
- Remove `--display-font` line

**UI Docs (`apps/ui-docs/src/styles/globals.css`):**
- Same as playground

**UI Docs (`apps/ui-docs/index.html`):**
- Google Fonts link: replace Inter with Instrument Sans

**Docs (`docs/docs.json`):**
- `heading.family` → `"Instrument Sans"`
- `body.family` → `"Instrument Sans"`

### Component changes

All `font-display` class usages (~8 occurrences in auth pages and homepage) → replace with `font-sans` + appropriate weight class (e.g. `font-semibold` or `font-bold`). Since both now resolve to Instrument Sans via `font-sans`, the visual hierarchy comes from weight and size only.

---

## 3. Icon Migration

### Dependency swap

In every package that uses icons:
- Remove `lucide-react`
- Add `@phosphor-icons/react`

Packages: `packages/ui`, `apps/console`, `apps/ui-docs`

### Usage pattern

No global `<IconContext.Provider>`. Each icon uses className for sizing and `weight="light"` prop:

```tsx
// Before (Lucide)
<X className="size-4" />

// After (Phosphor)
<X className="size-4" weight="light" />
```

### Icon name mapping

| Lucide | Phosphor |
|---|---|
| X | X |
| Menu | List |
| ChevronDown | CaretDown |
| Check | Check |
| AlertTriangle | Warning |
| Info | Info |
| ChevronsUpDown | CaretUpDown |

Full audit of all icon usages required at implementation time — each icon gets matched to its closest Phosphor equivalent.

### Button component cleanup

Remove the default icon size rule `[&_svg:not([class*='size-'])]:size-4` from button.tsx since Phosphor handles sizing via className explicitly.

---

## 4. Files Touched

| Layer | Files | Changes |
|---|---|---|
| Theme | `packages/tailwind-config/theme.css` | Colors, font tokens, base layer |
| UI package | `packages/ui/src/components/*.tsx` | Lucide → Phosphor imports, icon weight prop, remove `font-display` refs |
| UI package | `packages/ui/package.json` | Swap `lucide-react` → `@phosphor-icons/react` |
| Console | `apps/console/src/app/layout.tsx` | Font loading, remove displayFont, update theme-color |
| Console | `apps/console/src/app/auth/*.tsx`, `page.tsx` | Replace `font-display` classes, swap icons |
| Console | `apps/console/src/components/*.tsx` | Swap icons |
| Console | `apps/console/package.json` | Swap icon dependency |
| Playground | `apps/playground/src/index.css` | Font CSS vars, scrollbar colors |
| Playground | `apps/playground/src/App.tsx` + components | Swap icons |
| UI Docs | `apps/ui-docs/src/styles/globals.css` | Font CSS vars, scrollbar colors |
| UI Docs | `apps/ui-docs/index.html` | Google Fonts link |
| UI Docs | Components + registry | Icon swaps, update examples |
| Docs | `docs/docs.json` | Font family references |

### Not touched

- Geist Mono font
- Animation keyframes
- Radix UI primitives
- Component structure/behavior
- CLI terminal ANSI theme (`packages/cli/src/config/theme.ts`)

---

## 5. Design Principles (unchanged)

- Flat surfaces, no rounded corners
- Dashed borders
- Monochromatic neutral palette with swappable accent
- Mono font for buttons, code, tables, kbd
- Instrument Sans for everything else (body, headings, labels)
- Phosphor Light icons
