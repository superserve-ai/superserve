# Table Row Filter Animations

Animate table rows when filtering (search, status tabs) so removed rows fade out and remaining rows smoothly spring into place.

## Behavior

**When rows are filtered out:**
1. Removed rows fade out (150ms opacity)
2. Remaining rows spring upward to fill gaps (spring: bounce 0.15, duration 0.4)

**When rows are filtered back in:**
1. New rows fade in (150ms opacity)
2. Existing rows spring downward to make room

## Implementation

### AnimatedTableRow component

A reusable component that wraps `motion.tr` with:
- `layout` prop for smooth position transitions on reflow
- `initial={{ opacity: 0 }}` for enter animation
- `animate={{ opacity: 1 }}` 
- `exit={{ opacity: 0 }}` for removal
- `transition` matching the app's spring config for layout, 150ms ease for opacity
- Forwards all props/className/children — drop-in replacement for `TableRow` in filtered lists

### Per-page changes

Wrap each page's filtered `.map()` in `AnimatePresence` and swap `TableRow` for `AnimatedTableRow`:

- **Sandboxes** — `SandboxTableRow` internally renders `TableRow`. Change it to use `AnimatedTableRow`.
- **API Keys** — inline `TableRow` in map. Swap to `AnimatedTableRow`.
- **Snapshots** — inline `TableRow` in map. Swap to `AnimatedTableRow`.
- **Audit Logs** — inline `TableRow` in map. Swap to `AnimatedTableRow`.

### What stays untouched

- `StickyHoverTableBody` — works on whatever children it receives, no changes needed
- `TableToolbar` — search/tabs unchanged
- Table headers — not animated
- Selection logic — unchanged
- Base `TableRow` in `@superserve/ui` — unchanged, `AnimatedTableRow` is a console-level component

## Files

| Path | Action |
|---|---|
| `apps/console/src/components/animated-table-row.tsx` | Create — reusable motion.tr wrapper |
| `apps/console/src/components/sandboxes/sandbox-table-row.tsx` | Modify — use AnimatedTableRow |
| `apps/console/src/app/(dashboard)/sandboxes/page.tsx` | Modify — add AnimatePresence |
| `apps/console/src/app/(dashboard)/api-keys/page.tsx` | Modify — AnimatePresence + AnimatedTableRow |
| `apps/console/src/app/(dashboard)/snapshots/page.tsx` | Modify — AnimatePresence + AnimatedTableRow |
| `apps/console/src/app/(dashboard)/audit-logs/page.tsx` | Modify — AnimatePresence + AnimatedTableRow |

## Constraints

- No new dependencies — uses existing `motion` package
- Spring config matches existing patterns: `type: "spring", bounce: 0.15, duration: 0.4`
- Stable keys required on all rows (already using `item.id` everywhere)
- Must not interfere with sticky hover, selection, or row click handlers
