# Table Row Filter Animations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate table rows when filtering so removed rows fade out and remaining rows smoothly spring into place.

**Architecture:** A reusable `AnimatedTableRow` component wraps `motion.tr` with `layout` + fade enter/exit animations. Each page wraps its filtered `.map()` in `AnimatePresence` and swaps `TableRow` for `AnimatedTableRow`.

**Tech Stack:** motion (Framer Motion), React, existing `@superserve/ui` Table components

---

### Task 1: Create AnimatedTableRow Component

**Files:**
- Create: `apps/console/src/components/animated-table-row.tsx`

- [ ] **Step 1: Create the component**

Create `apps/console/src/components/animated-table-row.tsx`:

```tsx
"use client"

import { cn } from "@superserve/ui"
import { motion } from "motion/react"

interface AnimatedTableRowProps
  extends React.HTMLAttributes<HTMLTableRowElement> {
  children: React.ReactNode
}

export function AnimatedTableRow({
  className,
  children,
  ...props
}: AnimatedTableRowProps) {
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        layout: { type: "spring", bounce: 0.15, duration: 0.4 },
        opacity: { duration: 0.15, ease: "easeInOut" },
      }}
      className={cn("border-b border-border transition-colors", className)}
      {...props}
    >
      {children}
    </motion.tr>
  )
}
```

This mirrors `TableRow`'s className (`border-b border-border transition-colors`) so it's a drop-in replacement. The `layout` prop handles smooth position changes when siblings are added/removed. Opacity handles the fade in/out.

- [ ] **Step 2: Verify typecheck**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

---

### Task 2: Update SandboxTableRow to Use AnimatedTableRow

**Files:**
- Modify: `apps/console/src/components/sandboxes/sandbox-table-row.tsx`

- [ ] **Step 1: Replace TableRow with AnimatedTableRow**

In `apps/console/src/components/sandboxes/sandbox-table-row.tsx`:

Replace the import:
```tsx
// Before
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  TableCell,
  TableRow,
} from "@superserve/ui"
```

```tsx
// After
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  TableCell,
} from "@superserve/ui"
import { AnimatedTableRow } from "@/components/animated-table-row"
```

Then replace the `<TableRow` and `</TableRow>` in the JSX:

```tsx
// Before
    <TableRow
      className={cn("cursor-pointer", className)}
      onClick={() => router.push(`/sandboxes/${sandbox.id}/`)}
      {...rest}
    >
      {/* ... cells ... */}
    </TableRow>
```

```tsx
// After
    <AnimatedTableRow
      className={cn("cursor-pointer", className)}
      onClick={() => router.push(`/sandboxes/${sandbox.id}/`)}
      {...rest}
    >
      {/* ... cells ... */}
    </AnimatedTableRow>
```

- [ ] **Step 2: Verify typecheck**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

---

### Task 3: Add AnimatePresence to Sandboxes Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/sandboxes/page.tsx`

- [ ] **Step 1: Add AnimatePresence import**

Add to the imports at the top of the file:

```tsx
import { AnimatePresence } from "motion/react"
```

- [ ] **Step 2: Wrap the filtered.map() in AnimatePresence**

Replace lines 168-186:

```tsx
// Before
              <StickyHoverTableBody>
                {filtered.map((sandbox) => (
                  <SandboxTableRow
                    key={sandbox.id}
                    sandbox={sandbox}
                    selected={selected.has(sandbox.id)}
                    onToggle={() => toggleOne(sandbox.id)}
                    onConnect={() => setConnectSandboxId(sandbox.id)}
                    onDelete={() =>
                      setDeleteTarget({
                        id: sandbox.id,
                        name: sandbox.name,
                      })
                    }
                    onPause={() => pauseMutation.mutate(sandbox.id)}
                    onResume={() => resumeMutation.mutate(sandbox.id)}
                  />
                ))}
              </StickyHoverTableBody>
```

```tsx
// After
              <StickyHoverTableBody>
                <AnimatePresence initial={false}>
                  {filtered.map((sandbox) => (
                    <SandboxTableRow
                      key={sandbox.id}
                      sandbox={sandbox}
                      selected={selected.has(sandbox.id)}
                      onToggle={() => toggleOne(sandbox.id)}
                      onConnect={() => setConnectSandboxId(sandbox.id)}
                      onDelete={() =>
                        setDeleteTarget({
                          id: sandbox.id,
                          name: sandbox.name,
                        })
                      }
                      onPause={() => pauseMutation.mutate(sandbox.id)}
                      onResume={() => resumeMutation.mutate(sandbox.id)}
                    />
                  ))}
                </AnimatePresence>
              </StickyHoverTableBody>
```

`initial={false}` prevents the enter animation from playing on first render (rows should just appear instantly on page load).

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

---

### Task 4: Add Animations to API Keys Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/api-keys/page.tsx`

- [ ] **Step 1: Add imports**

Add to existing imports:

```tsx
import { AnimatePresence } from "motion/react"
import { AnimatedTableRow } from "@/components/animated-table-row"
```

Remove `TableRow` from the `@superserve/ui` import (it's no longer used in the filtered map — only in the header which uses `TableRow` from `TableHeader`'s children, not directly). Actually, `TableRow` is still used for the header row at line 152. Keep the import, just also add the new ones.

- [ ] **Step 2: Wrap filtered.map() in AnimatePresence and swap TableRow for AnimatedTableRow**

Replace lines 166-219:

```tsx
// Before
              <StickyHoverTableBody>
                {filtered.map((apiKey) => (
                  <TableRow key={apiKey.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(apiKey.id)}
                        onCheckedChange={() => toggleOne(apiKey.id)}
                        aria-label={`Select ${apiKey.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{apiKey.name}</TableCell>
                    <TableCell className="text-muted tabular-nums">
                      {formatDate(new Date(apiKey.created_at))}
                    </TableCell>
                    <TableCell className="text-muted tabular-nums">
                      {apiKey.last_used_at
                        ? formatDate(new Date(apiKey.last_used_at))
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Key actions"
                            />
                          }
                        >
                          <DotsThreeVerticalIcon
                            className="size-4"
                            weight="bold"
                          />
                        </MenuTrigger>
                        <MenuPopup>
                          <MenuItem
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              setRevokeTarget({
                                id: apiKey.id,
                                name: apiKey.name,
                              })
                            }
                          >
                            <TrashIcon className="size-4" weight="light" />
                            Revoke Key
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
```

```tsx
// After
              <StickyHoverTableBody>
                <AnimatePresence initial={false}>
                  {filtered.map((apiKey) => (
                    <AnimatedTableRow key={apiKey.id}>
                      <TableCell className="pr-0">
                        <Checkbox
                          checked={selected.has(apiKey.id)}
                          onCheckedChange={() => toggleOne(apiKey.id)}
                          aria-label={`Select ${apiKey.name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {apiKey.name}
                      </TableCell>
                      <TableCell className="text-muted tabular-nums">
                        {formatDate(new Date(apiKey.created_at))}
                      </TableCell>
                      <TableCell className="text-muted tabular-nums">
                        {apiKey.last_used_at
                          ? formatDate(new Date(apiKey.last_used_at))
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Key actions"
                              />
                            }
                          >
                            <DotsThreeVerticalIcon
                              className="size-4"
                              weight="bold"
                            />
                          </MenuTrigger>
                          <MenuPopup>
                            <MenuItem
                              className="text-destructive hover:text-destructive"
                              onClick={() =>
                                setRevokeTarget({
                                  id: apiKey.id,
                                  name: apiKey.name,
                                })
                              }
                            >
                              <TrashIcon className="size-4" weight="light" />
                              Revoke Key
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </TableCell>
                    </AnimatedTableRow>
                  ))}
                </AnimatePresence>
              </StickyHoverTableBody>
```

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

---

### Task 5: Add Animations to Snapshots Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/snapshots/page.tsx`

- [ ] **Step 1: Add imports**

Add to existing imports:

```tsx
import { AnimatePresence } from "motion/react"
import { AnimatedTableRow } from "@/components/animated-table-row"
```

- [ ] **Step 2: Wrap filtered.map() in AnimatePresence and swap TableRow**

Replace lines 113-154:

```tsx
// Before
              <StickyHoverTableBody>
                {filtered.map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(snapshot.id)}
                        onCheckedChange={() => toggleOne(snapshot.id)}
                        aria-label={`Select ${snapshot.name ?? snapshot.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {snapshot.name ?? `${snapshot.sandbox_id.slice(0, 8)}...`}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted tabular-nums">
                      {formatBytes(snapshot.size_bytes)}
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {TRIGGER_LABEL[snapshot.trigger] ?? snapshot.trigger}
                    </TableCell>
                    <TableCell>
                      <Badge variant={snapshot.saved ? "success" : "muted"} dot>
                        {snapshot.saved ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted tabular-nums">
                      {formatDate(new Date(snapshot.created_at))}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Snapshot actions"
                      >
                        <DotsThreeVerticalIcon
                          className="size-4"
                          weight="bold"
                        />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
```

```tsx
// After
              <StickyHoverTableBody>
                <AnimatePresence initial={false}>
                  {filtered.map((snapshot) => (
                    <AnimatedTableRow key={snapshot.id}>
                      <TableCell className="pr-0">
                        <Checkbox
                          checked={selected.has(snapshot.id)}
                          onCheckedChange={() => toggleOne(snapshot.id)}
                          aria-label={`Select ${snapshot.name ?? snapshot.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-foreground/80">
                        {snapshot.name ??
                          `${snapshot.sandbox_id.slice(0, 8)}...`}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted tabular-nums">
                        {formatBytes(snapshot.size_bytes)}
                      </TableCell>
                      <TableCell className="text-foreground/80">
                        {TRIGGER_LABEL[snapshot.trigger] ?? snapshot.trigger}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={snapshot.saved ? "success" : "muted"}
                          dot
                        >
                          {snapshot.saved ? "Yes" : "No"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted tabular-nums">
                        {formatDate(new Date(snapshot.created_at))}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Snapshot actions"
                        >
                          <DotsThreeVerticalIcon
                            className="size-4"
                            weight="bold"
                          />
                        </Button>
                      </TableCell>
                    </AnimatedTableRow>
                  ))}
                </AnimatePresence>
              </StickyHoverTableBody>
```

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

---

### Task 6: Add Animations to Audit Logs Page

**Files:**
- Modify: `apps/console/src/app/(dashboard)/audit-logs/page.tsx`

- [ ] **Step 1: Add imports**

Add to existing imports:

```tsx
import { AnimatePresence } from "motion/react"
import { AnimatedTableRow } from "@/components/animated-table-row"
```

- [ ] **Step 2: Wrap filtered.map() in AnimatePresence and swap TableRow**

Replace lines 145-198:

```tsx
// Before
              <StickyHoverTableBody>
                {filtered.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">
                      <TimeCell date={new Date(log.created_at)} />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {log.sandbox_name ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted capitalize">
                      {log.category}
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {log.action}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted tabular-nums">
                      {formatDuration(log.duration_ms)}
                    </TableCell>
                    <TableCell>
                      {log.status ? (
                        log.error ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Badge
                                  variant={
                                    STATUS_VARIANT[log.status] ?? "muted"
                                  }
                                  dot
                                  className="cursor-default"
                                />
                              }
                            >
                              {log.status}
                            </TooltipTrigger>
                            <TooltipPopup className="max-w-xs text-xs">
                              {log.error}
                            </TooltipPopup>
                          </Tooltip>
                        ) : (
                          <Badge
                            variant={STATUS_VARIANT[log.status] ?? "muted"}
                            dot
                          >
                            {log.status}
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
```

```tsx
// After
              <StickyHoverTableBody>
                <AnimatePresence initial={false}>
                  {filtered.map((log) => (
                    <AnimatedTableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        <TimeCell date={new Date(log.created_at)} />
                      </TableCell>
                      <TableCell className="font-mono text-foreground/80">
                        {log.sandbox_name ?? "-"}
                      </TableCell>
                      <TableCell className="text-muted capitalize">
                        {log.category}
                      </TableCell>
                      <TableCell className="text-foreground/80">
                        {log.action}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted tabular-nums">
                        {formatDuration(log.duration_ms)}
                      </TableCell>
                      <TableCell>
                        {log.status ? (
                          log.error ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Badge
                                    variant={
                                      STATUS_VARIANT[log.status] ?? "muted"
                                    }
                                    dot
                                    className="cursor-default"
                                  />
                                }
                              >
                                {log.status}
                              </TooltipTrigger>
                              <TooltipPopup className="max-w-xs text-xs">
                                {log.error}
                              </TooltipPopup>
                            </Tooltip>
                          ) : (
                            <Badge
                              variant={STATUS_VARIANT[log.status] ?? "muted"}
                              dot
                            >
                              {log.status}
                            </Badge>
                          )
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </TableCell>
                    </AnimatedTableRow>
                  ))}
                </AnimatePresence>
              </StickyHoverTableBody>
```

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/console && bunx tsc --pretty --noEmit
```

Expected: no errors.

---

### Task 7: Lint, Build, and Verify

- [ ] **Step 1: Run lint with auto-fix**

```bash
cd apps/console && bunx biome check --write .
```

Expected: no errors after auto-fix.

- [ ] **Step 2: Run full build**

```bash
cd /path/to/repo && bunx turbo run build --filter=@superserve/console
```

Expected: build succeeds.

- [ ] **Step 3: Manual verification**

Open the console in the browser and test each page:
- Sandboxes: type in search, toggle status tabs — rows should fade out and remaining rows slide up
- API Keys: type in search — same animation
- Snapshots: type in search — same animation
- Audit Logs: type in search, toggle category tabs — same animation
- Verify sticky hover still works on all tables
- Verify row click navigation still works on sandboxes
- Verify checkbox selection still works on all tables
