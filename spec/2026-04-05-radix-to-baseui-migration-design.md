# Radix UI to Base UI Migration

Migration of `@superserve/ui` component library from Radix UI primitives to Base UI, adopting Base UI conventions throughout.

## Goals

- Remove all 12 `@radix-ui/*` packages, replace with single `@base-ui/react`
- Adopt Base UI naming conventions, API patterns, and animation system
- Replace custom FormField, Input, and Progress with Base UI primitives
- Update all consumer code (console app, ui-docs) to new APIs
- Best-in-class UX with smooth CSS-based animations

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Migration strategy | Big-bang (single pass) | Small library, single consumer, fully mechanical changes |
| Animation system | Base UI CSS for Base UI components, keep Motion for custom components | GPU-composited, zero JS overhead, identical visual result |
| `asChild` pattern | Replace with `render` prop | Match Base UI convention |
| Component naming | Adopt Base UI names | Clean break, no aliases |
| Select API | Fully adopt Base UI pattern | Consistent conventions |
| Custom components | Adopt Base UI primitives where available | FormField → Field, Input → Base UI Input, Progress → Base UI Progress |

## Dependency Changes

### Remove from `packages/ui/package.json`

```
@radix-ui/react-accordion
@radix-ui/react-avatar
@radix-ui/react-checkbox
@radix-ui/react-dialog
@radix-ui/react-dropdown-menu
@radix-ui/react-popover
@radix-ui/react-radio-group
@radix-ui/react-select
@radix-ui/react-slot
@radix-ui/react-switch
@radix-ui/react-tabs
@radix-ui/react-tooltip
```

### Add to `packages/ui/package.json`

```
@base-ui/react
```

### Keep

- `motion` — used in Toast and other custom components (not removed)

## Component Migration Map

### Radix → Base UI Components

| Current (Radix) | New (Base UI) | Import Path | Key Changes |
|---|---|---|---|
| Accordion | Accordion | `@base-ui/react/accordion` | `type="single"` → `multiple={false}`, `AccordionContent` → `AccordionPanel`, add `AccordionHeading` |
| Avatar | Avatar | `@base-ui/react/avatar` | Dot notation subcomponents |
| Button | Custom (no Slot) | N/A | Remove `@radix-ui/react-slot`, `asChild` → `render` prop |
| Checkbox | Checkbox | `@base-ui/react/checkbox` | Animations move to CSS (`data-starting-style`/`data-ending-style`) |
| Dialog | Dialog | `@base-ui/react/dialog` | `DialogContent` → `DialogPopup`, add `DialogBackdrop`, CSS animations |
| DropdownMenu | Menu | `@base-ui/react/menu` | Renamed entirely, `onSelect` → `onClick`, add `MenuPositioner` |
| Popover | Popover | `@base-ui/react/popover` | `PopoverContent` → `PopoverPopup`, add `PopoverPositioner`, CSS animations |
| RadioGroup | Radio | `@base-ui/react/radio` | Renamed, CSS animations |
| Select | Select | `@base-ui/react/select` | Major API change: add `SelectPositioner`, `SelectContent` → `SelectPopup` |
| Switch | Switch | `@base-ui/react/switch` | Minimal changes |
| Tabs | Tabs | `@base-ui/react/tabs` | `TabsTrigger` → `TabsTab`, `TabsContent` → `TabsPanel` |
| Tooltip | Tooltip | `@base-ui/react/tooltip` | `TooltipContent` → `TooltipPopup`, add `TooltipPositioner`, CSS animations |

### Custom → Base UI Components

| Current | New (Base UI) | Import Path | Key Changes |
|---|---|---|---|
| FormField | Field | `@base-ui/react/field` | `Field.Root`, `Field.Label`, `Field.Error`, `Field.Description` |
| Input | Input | `@base-ui/react/input` | Wrap with Base UI Input for a11y integration with Field |
| Progress | Progress | `@base-ui/react/progress` | `Progress.Root`, `Progress.Track`, `Progress.Indicator` |

## Export Rename Summary

Consumer-facing name changes in `@superserve/ui`:

```
DialogContent       → DialogPopup
DropdownMenu        → Menu
DropdownMenuTrigger → MenuTrigger
DropdownMenuContent → MenuPopup
DropdownMenuItem    → MenuItem
DropdownMenuSeparator → MenuSeparator
PopoverContent      → PopoverPopup
TabsTrigger         → TabsTab
TabsContent         → TabsPanel
TooltipContent      → TooltipPopup
SelectContent       → SelectPopup
FormField           → Field, FieldLabel, FieldError, FieldDescription
```

Kept as-is: `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`, `Dialog`, `DialogTrigger`.

## Button Component

Remove `@radix-ui/react-slot`. Replace `asChild` with `render` prop:

```tsx
function Button({ className, variant, size, render, ...props }) {
  const classes = cn(buttonVariants({ variant, size }), className)
  if (render) {
    return cloneElement(render, { ...props, className: classes })
  }
  return <button className={classes} {...props} />
}
```

Consumer change:
```tsx
// Before
<Button asChild><Link href="/foo">Go</Link></Button>

// After
<Button render={<Link href="/foo" />}>Go</Button>
```

## Select Component

Wrapper keeps consumer API clean by internalizing Positioner/Portal:

```tsx
// Consumer writes:
<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Pick one" />
  </SelectTrigger>
  <SelectPopup>
    <SelectItem value="a">Option A</SelectItem>
    <SelectItem value="b">Option B</SelectItem>
  </SelectPopup>
</Select>

// SelectPopup internally wraps Select.Portal + Select.Positioner + Select.Popup
```

## Animation Strategy

### Base UI Components — CSS animations

Replace Motion with Base UI's `data-starting-style`/`data-ending-style` system:

```css
.dialog-popup {
  transition: opacity 150ms ease, transform 150ms ease;
  opacity: 1;
  transform: scale(1);
}

.dialog-popup[data-starting-style],
.dialog-popup[data-ending-style] {
  opacity: 0;
  transform: scale(0.96);
}
```

Components getting CSS animations (Motion removed):
- Dialog — fade + scale
- Popover — fade + scale
- Tooltip — fade + scale
- Checkbox — indicator fade
- Radio — indicator fade
- Confirm Dialog — inherits from Dialog

Animation styles live in `packages/ui/src/styles/globals.css` alongside existing component styles. Shared animation keyframes (accordion-down, accordion-up, fade-in) remain in `packages/tailwind-config/theme.css`.

### Custom Components — keep Motion

- Toast — slide/fade with Motion (unchanged)
- Any other custom animations in console app

## File Structure Changes

### Renamed files in `packages/ui/src/components/`

| Current | New | Reason |
|---|---|---|
| `dropdown-menu.tsx` | `menu.tsx` | Match Base UI naming |
| `radio-group.tsx` | `radio.tsx` | Match Base UI naming |
| `form-field.tsx` | `field.tsx` | Replaced with Base UI Field |

All other component files keep their names but are rewritten internally.

### Updated files

- `packages/ui/src/index.ts` — barrel exports updated with new names
- `packages/ui/src/styles/globals.css` — Base UI animation styles added
- `packages/ui/package.json` — dependency swap
- `packages/tailwind-config/theme.css` — animation keyframes if needed

## Consumer Updates

### Console App (`apps/console/`)

All files importing from `@superserve/ui` updated:

- Import names changed (e.g. `DialogContent` → `DialogPopup`, `DropdownMenu*` → `Menu*`)
- `asChild` → `render={<Component />}` on Button compositions
- `onSelect` → `onClick` on menu items
- `FormField` usage → `Field` + `FieldLabel` + `FieldError`
- `side`/`align` props handled internally by wrappers

### UI Docs App (`apps/ui-docs/`)

- All example files in `src/examples/` updated to new names and patterns
- Documentation text references updated

## Testing Strategy

- Typecheck: `bunx turbo run typecheck` — catches all import/prop errors
- Lint: `bunx turbo run lint` — catches unused imports
- Visual: manually verify each component in ui-docs
- Console: run dev server, test all interactive components (dialogs, selects, menus, tooltips)

## References

- [Base UI docs](https://base-ui.com/react/overview/quick-start)
- [Base UI styling handbook](https://base-ui.com/react/handbook/styling)
- [basecn — shadcn/ui on Base UI](https://basecn.dev)
- [basecn migration guide](https://basecn.dev/docs/get-started/migrating-from-radix-ui)
- [coss ui Radix migration guide](https://coss.com/ui/docs/radix-migration)
- [asChild-to-render codemod](https://gist.github.com/phibr0/48ac88eafbd711784963a3b72015fd09)
