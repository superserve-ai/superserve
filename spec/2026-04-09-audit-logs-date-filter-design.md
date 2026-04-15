# Audit Logs Date Filter

Inline date preset badges + calendar popover for custom range on the audit logs page.

## Toolbar Layout

```
[All 42] [Sandbox 28] [Exec 10] [Errors 4] ... [Today] [Yesterday] [7d] [30d] [Custom ▾] [🔍 Search]
```

## Preset Badges

- `Today` — midnight today to now
- `Yesterday` — midnight yesterday to midnight today
- `7d` — 7 days ago to now
- `30d` — 30 days ago to now
- Toggle behavior: click to activate, click again to clear
- Only one active at a time (mutually exclusive with custom range)
- Active preset: `bg-foreground/4` background
- Styling: `font-mono text-xs uppercase` matching button/badge conventions

## Custom Range

- "Custom" badge opens a Popover (existing `@superserve/ui` Popover, dashed border)
- Inside popover: two date inputs (Start / End) styled to match the Input component, plus Apply button
- When a custom range is active, the badge text changes to show the range (e.g., `Mar 3 – Mar 7`)
- Click the active custom badge to clear

## Filtering

- Client-side, added to the existing `useMemo` filter chain alongside category and search
- Compares `created_at` against the selected date range
- State: `dateRange: { start: Date; end: Date } | null` — null means no date filter

## Components

### DateRangeFilter

New component at `apps/console/src/components/date-range-filter.tsx`.

Props:
- `value: { start: Date; end: Date } | null`
- `onChange: (range: { start: Date; end: Date } | null) => void`

Renders the preset badges and the Custom popover trigger/content.

### TableToolbar

Add optional `filters` prop (`ReactNode`) that renders between tabs and search. Keeps the toolbar generic — no date-specific logic in it.

## Files

| Path | Action |
|---|---|
| `apps/console/src/components/date-range-filter.tsx` | Create |
| `apps/console/src/components/table-toolbar.tsx` | Modify — add `filters` slot |
| `apps/console/src/app/(dashboard)/audit-logs/page.tsx` | Modify — add date state + pass DateRangeFilter |
