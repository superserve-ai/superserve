# Radix UI → Base UI Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `@superserve/ui` component library from Radix UI to Base UI, adopting Base UI conventions throughout, and update all consumers.

**Architecture:** Replace 12 `@radix-ui/*` packages with single `@base-ui/react`. Each component is rewritten to use Base UI primitives with CSS animations replacing Motion. Consumer code (console app, ui-docs) is updated to match new export names and API patterns.

**Tech Stack:** Base UI v1.x, React 18/19, Tailwind CSS v4, Motion (kept for custom components only)

**Spec:** `spec/2026-04-05-radix-to-baseui-migration-design.md`

---

## File Map

### Modified files in `packages/ui/src/components/`

| File | Change |
|---|---|
| `accordion.tsx` | Rewrite with Base UI Accordion |
| `avatar.tsx` | Rewrite with Base UI Avatar |
| `button.tsx` | Remove Slot, add `render` prop |
| `checkbox.tsx` | Rewrite with Base UI Checkbox, CSS animations |
| `dialog.tsx` | Rewrite with Base UI Dialog, CSS animations |
| `dropdown-menu.tsx` → `menu.tsx` | Rename + rewrite with Base UI Menu |
| `popover.tsx` | Rewrite with Base UI Popover, CSS animations |
| `radio-group.tsx` → `radio.tsx` | Rename + rewrite with Base UI Radio |
| `select.tsx` | Rewrite with Base UI Select |
| `switch.tsx` | Rewrite with Base UI Switch |
| `tabs.tsx` | Rewrite with Base UI Tabs |
| `tooltip.tsx` | Rewrite with Base UI Tooltip, CSS animations |
| `form-field.tsx` → `field.tsx` | Rename + rewrite with Base UI Field |
| `input.tsx` | Wrap with Base UI Input |
| `progress.tsx` | Rewrite with Base UI Progress |
| `confirm-dialog.tsx` | Update to use new Dialog exports |

### Other modified files

| File | Change |
|---|---|
| `packages/ui/package.json` | Swap dependencies |
| `packages/ui/src/index.ts` | Update all exports |
| `packages/ui/src/styles/globals.css` | Add Base UI animation styles |
| `packages/tailwind-config/theme.css` | Update accordion animation vars |
| 31 files in `apps/console/src/` | Update imports and component usage |
| 33 files in `apps/ui-docs/src/` | Update imports and component usage |

---

## Task 1: Swap Dependencies

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Remove Radix packages and add Base UI**

```bash
cd /Users/nirnejak/Code/superserve/superserve
bun remove @radix-ui/react-accordion @radix-ui/react-avatar @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-popover @radix-ui/react-radio-group @radix-ui/react-select @radix-ui/react-slot @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-tooltip --filter @superserve/ui
```

- [ ] **Step 2: Add Base UI**

```bash
bun add @base-ui/react --filter @superserve/ui
```

- [ ] **Step 3: Verify installation**

```bash
bun install
```

Expected: No errors, `bun.lock` updated.

---

## Task 2: Add Base UI Animation Styles

**Files:**
- Modify: `packages/ui/src/styles/globals.css`
- Modify: `packages/tailwind-config/theme.css`

- [ ] **Step 1: Add animation styles to globals.css**

Add these CSS rules after the existing imports in `packages/ui/src/styles/globals.css`:

```css
/* Base UI component animations */

/* Dialog */
.ss-dialog-backdrop {
  transition: opacity 200ms ease;
  opacity: 1;
}
.ss-dialog-backdrop[data-starting-style],
.ss-dialog-backdrop[data-ending-style] {
  opacity: 0;
}

.ss-dialog-popup {
  transition: opacity 200ms ease, transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.ss-dialog-popup[data-starting-style],
.ss-dialog-popup[data-ending-style] {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.96);
}

/* Popover */
.ss-popover-popup {
  transition: opacity 120ms ease-out, transform 120ms ease-out;
  opacity: 1;
  transform: scale(1);
}
.ss-popover-popup[data-starting-style],
.ss-popover-popup[data-ending-style] {
  opacity: 0;
  transform: scale(0.96);
}

/* Tooltip */
.ss-tooltip-popup {
  transition: opacity 150ms ease-out, transform 150ms ease-out;
  opacity: 1;
  transform: scale(1);
}
.ss-tooltip-popup[data-starting-style],
.ss-tooltip-popup[data-ending-style] {
  opacity: 0;
  transform: scale(0.96);
}

/* Menu */
.ss-menu-popup {
  transition: opacity 120ms ease-out, transform 120ms ease-out;
  opacity: 1;
  transform: scale(1);
}
.ss-menu-popup[data-starting-style],
.ss-menu-popup[data-ending-style] {
  opacity: 0;
  transform: scale(0.96);
}

/* Select */
.ss-select-popup {
  transition: opacity 120ms ease-out, transform 120ms ease-out;
  opacity: 1;
  transform: scale(1);
}
.ss-select-popup[data-starting-style],
.ss-select-popup[data-ending-style] {
  opacity: 0;
  transform: scale(0.96);
}

/* Checkbox indicator */
.ss-checkbox-indicator {
  transition: opacity 100ms ease, transform 100ms ease;
  opacity: 1;
  transform: scale(1);
}
.ss-checkbox-indicator[data-starting-style] {
  opacity: 0;
  transform: scale(0);
}
.ss-checkbox-indicator[data-ending-style] {
  opacity: 0;
  transform: scale(0);
}

/* Radio indicator */
.ss-radio-indicator {
  transition: opacity 100ms ease, transform 100ms ease;
  opacity: 1;
  transform: scale(1);
}
.ss-radio-indicator[data-starting-style] {
  opacity: 0;
  transform: scale(0);
}
.ss-radio-indicator[data-ending-style] {
  opacity: 0;
  transform: scale(0);
}

/* Accordion panel */
.ss-accordion-panel {
  overflow: hidden;
  transition: height 200ms ease-out;
}
.ss-accordion-panel[data-starting-style],
.ss-accordion-panel[data-ending-style] {
  height: 0;
}
```

- [ ] **Step 2: Update accordion animation in theme.css**

In `packages/tailwind-config/theme.css`, replace the Radix CSS variable references in the accordion keyframes:

Replace:
```css
  --animate-accordion-down: accordion-down 0.2s ease-out;
  --animate-accordion-up: accordion-up 0.2s ease-out;
```

With:
```css
  --animate-accordion-down: accordion-down 0.2s ease-out;
  --animate-accordion-up: accordion-up 0.2s ease-out;
```

And update the keyframes from `--radix-accordion-content-height` to `--accordion-panel-height` (Base UI convention):

Replace:
```css
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

With:
```css
@keyframes accordion-down {
  from {
    height: 0;
  }
  to {
    height: var(--accordion-panel-height);
  }
}

@keyframes accordion-up {
  from {
    height: var(--accordion-panel-height);
  }
  to {
    height: 0;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/styles/globals.css packages/tailwind-config/theme.css
git commit -m "feat: add Base UI animation styles"
```

---

## Task 3: Migrate Button Component

**Files:**
- Modify: `packages/ui/src/components/button.tsx`

- [ ] **Step 1: Rewrite button.tsx**

Remove the `@radix-ui/react-slot` import and `asChild` prop. Add `render` prop using `cloneElement`:

```tsx
import { type VariantProps, cva } from "class-variance-authority"
import { type ReactElement, cloneElement } from "react"

import { cn } from "../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-mono font-medium uppercase transition-colors disabled:pointer-events-none disabled:opacity-30 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus aria-invalid:ring-destructive/20 aria-invalid:ring-2",
  {
    variants: {
      variant: {
        default: "bg-primary text-background hover:bg-primary-hover",
        destructive:
          "bg-destructive text-foreground hover:bg-destructive-hover focus-visible:ring-destructive/20",
        outline:
          "border border-dashed border-border bg-background hover:bg-surface-hover hover:text-foreground",
        ghost: "hover:bg-surface-hover hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline normal-case font-sans",
      },
      size: {
        default: "h-9 px-6",
        sm: "h-8 px-4 gap-1.5",
        lg: "h-10 px-8",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  render?: ReactElement
}

function Button({
  className,
  variant,
  size,
  render,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }))

  if (render) {
    return cloneElement(render, {
      ...props,
      className: cn(classes, render.props.className),
      children,
    })
  }

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/button.tsx
git commit -m "feat: migrate Button from Radix Slot to render prop"
```

---

## Task 4: Migrate Switch Component

**Files:**
- Modify: `packages/ui/src/components/switch.tsx`

- [ ] **Step 1: Rewrite switch.tsx**

```tsx
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "../lib/utils"

interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  required?: boolean
  name?: string
  value?: string
  id?: string
  className?: string
  label?: string
}

function Switch({ className, label, id, ...props }: SwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <SwitchPrimitive.Root
        id={id}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          "disabled:cursor-not-allowed disabled:opacity-30",
          "data-[checked]:bg-primary data-[unchecked]:bg-input",
          className
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
            "data-[checked]:translate-x-4 data-[unchecked]:translate-x-0"
          )}
        />
      </SwitchPrimitive.Root>
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-foreground cursor-pointer"
        >
          {label}
        </label>
      )}
    </div>
  )
}

export { Switch }
export type { SwitchProps }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/switch.tsx
git commit -m "feat: migrate Switch to Base UI"
```

---

## Task 5: Migrate Avatar Component

**Files:**
- Modify: `packages/ui/src/components/avatar.tsx`

- [ ] **Step 1: Rewrite avatar.tsx**

```tsx
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "../lib/utils"

type AvatarSize = "xs" | "sm" | "default" | "lg"

const sizeClasses: Record<AvatarSize, string> = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-7 w-7 text-xs",
  default: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
}

interface AvatarProps {
  src?: string | null
  alt?: string
  fallback: string
  size?: AvatarSize
  className?: string
}

function Avatar({
  src,
  alt,
  fallback,
  size = "default",
  className,
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        sizeClasses[size],
        className
      )}
    >
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt={alt}
          className="aspect-square h-full w-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center bg-surface font-mono text-muted uppercase border border-dashed border-border rounded-full"
      >
        {fallback}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

export { Avatar }
export type { AvatarProps, AvatarSize }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/avatar.tsx
git commit -m "feat: migrate Avatar to Base UI"
```

---

## Task 6: Migrate Checkbox Component

**Files:**
- Modify: `packages/ui/src/components/checkbox.tsx`

- [ ] **Step 1: Rewrite checkbox.tsx**

Replace Motion animation with CSS-based animation using the `ss-checkbox-indicator` class from globals.css:

```tsx
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "@phosphor-icons/react"

import { cn } from "../lib/utils"

interface CheckboxProps {
  checked?: boolean | "indeterminate"
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  required?: boolean
  name?: string
  value?: string
  id?: string
  className?: string
  label?: string
  "aria-label"?: string
}

function Checkbox({ className, label, id, ...props }: CheckboxProps) {
  return (
    <div className="flex items-center gap-2">
      <CheckboxPrimitive.Root
        id={id}
        className={cn(
          "peer h-4 w-4 shrink-0 border border-foreground/25 rounded-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          "disabled:cursor-not-allowed disabled:opacity-30",
          "data-[checked]:bg-primary data-[checked]:border-primary",
          className
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator
          className="ss-checkbox-indicator flex items-center justify-center"
          keepMounted
        >
          <CheckIcon weight="bold" className="h-3 w-3 text-background" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-foreground cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-30"
        >
          {label}
        </label>
      )}
    </div>
  )
}

export { Checkbox }
export type { CheckboxProps }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/checkbox.tsx
git commit -m "feat: migrate Checkbox to Base UI with CSS animations"
```

---

## Task 7: Migrate Radio Component

**Files:**
- Rename: `packages/ui/src/components/radio-group.tsx` → `packages/ui/src/components/radio.tsx`

- [ ] **Step 1: Delete old file and create radio.tsx**

```bash
rm packages/ui/src/components/radio-group.tsx
```

Write `packages/ui/src/components/radio.tsx`:

```tsx
import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import { cn } from "../lib/utils"

interface RadioGroupProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  name?: string
  className?: string
  children: React.ReactNode
}

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

interface RadioGroupItemProps {
  value: string
  disabled?: boolean
  id?: string
  className?: string
  label?: string
}

function RadioGroupItem({
  className,
  label,
  id,
  value,
  ...props
}: RadioGroupItemProps) {
  return (
    <div className="flex items-center gap-2">
      <RadioPrimitive.Root
        id={id}
        value={value}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded-full border border-input transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          "disabled:cursor-not-allowed disabled:opacity-30",
          "data-[checked]:border-primary",
          className
        )}
        {...props}
      >
        <RadioPrimitive.Indicator className="ss-radio-indicator flex items-center justify-center" keepMounted>
          <span className="h-2 w-2 rounded-full bg-primary" />
        </RadioPrimitive.Indicator>
      </RadioPrimitive.Root>
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-foreground cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-30"
        >
          {label}
        </label>
      )}
    </div>
  )
}

export { RadioGroup, RadioGroupItem }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/radio.tsx
git commit -m "feat: migrate RadioGroup to Base UI Radio"
```

---

## Task 8: Migrate Tabs Component

**Files:**
- Modify: `packages/ui/src/components/tabs.tsx`

- [ ] **Step 1: Rewrite tabs.tsx**

```tsx
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "../lib/utils"

const Tabs = TabsPrimitive.Root

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex border-b border-border", className)}
      {...props}
    />
  )
}

function TabsTab({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "px-4 py-2 text-sm font-medium text-muted transition-colors",
        "border-b-2 border-transparent -mb-px",
        "hover:text-foreground",
        "data-[selected]:border-primary data-[selected]:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      className={cn("mt-4 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsPanel }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/tabs.tsx
git commit -m "feat: migrate Tabs to Base UI"
```

---

## Task 9: Migrate Accordion Component

**Files:**
- Modify: `packages/ui/src/components/accordion.tsx`

- [ ] **Step 1: Rewrite accordion.tsx**

```tsx
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { CaretDownIcon } from "@phosphor-icons/react"

import { cn } from "../lib/utils"

interface AccordionProps {
  multiple?: boolean
  defaultValue?: string[]
  value?: string[]
  onValueChange?: (value: string[]) => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}

function Accordion({ className, ...props }: AccordionProps) {
  return (
    <AccordionPrimitive.Root
      className={cn("w-full", className)}
      {...props}
    />
  )
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn("border-b border-border", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header>
      <AccordionPrimitive.Trigger
        className={cn(
          "flex flex-1 w-full items-center justify-between py-4 text-sm font-medium text-foreground transition-all",
          "hover:underline",
          "[&[data-panel-open]>svg]:rotate-180",
          className
        )}
        {...props}
      >
        {children}
        <CaretDownIcon
          weight="light"
          className="h-4 w-4 shrink-0 text-muted transition-transform duration-200"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionPanel({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Panel>) {
  return (
    <AccordionPrimitive.Panel
      className={cn("ss-accordion-panel text-sm", className)}
      {...props}
    >
      <div className="pb-4 pt-0">{children}</div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionPanel }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/accordion.tsx
git commit -m "feat: migrate Accordion to Base UI"
```

---

## Task 10: Migrate Tooltip Component

**Files:**
- Modify: `packages/ui/src/components/tooltip.tsx`

- [ ] **Step 1: Rewrite tooltip.tsx**

```tsx
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "../lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

function TooltipTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger className={className} {...props} />
}

function TooltipPopup({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> & {
  sideOffset?: number
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset}>
        <TooltipPrimitive.Popup
          className={cn(
            "ss-tooltip-popup z-50 bg-foreground text-background px-2 py-1 text-xs rounded",
            className
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipPopup }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/tooltip.tsx
git commit -m "feat: migrate Tooltip to Base UI with CSS animations"
```

---

## Task 11: Migrate Popover Component

**Files:**
- Modify: `packages/ui/src/components/popover.tsx`

- [ ] **Step 1: Rewrite popover.tsx**

```tsx
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "../lib/utils"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

function PopoverPopup({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> & {
  sideOffset?: number
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner sideOffset={sideOffset}>
        <PopoverPrimitive.Popup
          className={cn(
            "ss-popover-popup z-50 min-w-[8rem] overflow-hidden border border-dashed border-border bg-surface p-4 rounded-md",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverPopup }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/popover.tsx
git commit -m "feat: migrate Popover to Base UI with CSS animations"
```

---

## Task 12: Migrate Dialog Component

**Files:**
- Modify: `packages/ui/src/components/dialog.tsx`

- [ ] **Step 1: Rewrite dialog.tsx**

```tsx
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "@phosphor-icons/react"
import { createContext, useContext, useState } from "react"

import { cn } from "../lib/utils"

const DialogOpenContext = createContext<boolean>(false)
export function useDialogOpen() {
  return useContext(DialogOpenContext)
}

interface DialogProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

function Dialog({
  children,
  open: controlledOpen,
  onOpenChange,
  ...props
}: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  return (
    <DialogPrimitive.Root
      {...props}
      open={open}
      onOpenChange={(value) => {
        if (!isControlled) setUncontrolledOpen(value)
        onOpenChange?.(value)
      }}
    >
      <DialogOpenContext.Provider value={open}>
        {children}
      </DialogOpenContext.Provider>
    </DialogPrimitive.Root>
  )
}

const DialogTrigger = DialogPrimitive.Trigger

function DialogPopup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        className="ss-dialog-backdrop fixed inset-0 z-50 bg-black/50"
      />
      <DialogPrimitive.Popup
        className={cn(
          "ss-dialog-popup fixed left-1/2 top-1/2 z-50 w-full max-w-md bg-surface border border-dashed border-border rounded-md shadow-lg",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-4 right-4 text-muted hover:text-foreground transition-colors"
        >
          <XIcon weight="light" className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-6 pb-4", className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex justify-end gap-3 p-6 pt-4", className)}
      {...props}
    />
  )
}

const DialogClose = DialogPrimitive.Close

export {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/dialog.tsx
git commit -m "feat: migrate Dialog to Base UI with CSS animations"
```

---

## Task 13: Migrate Menu Component (formerly DropdownMenu)

**Files:**
- Rename: `packages/ui/src/components/dropdown-menu.tsx` → `packages/ui/src/components/menu.tsx`

- [ ] **Step 1: Delete old file and create menu.tsx**

```bash
rm packages/ui/src/components/dropdown-menu.tsx
```

Write `packages/ui/src/components/menu.tsx`:

```tsx
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "../lib/utils"

const Menu = MenuPrimitive.Root
const MenuTrigger = MenuPrimitive.Trigger

function MenuPopup({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  sideOffset?: number
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={sideOffset}>
        <MenuPrimitive.Popup
          className={cn(
            "ss-menu-popup z-50 min-w-32 border border-dashed border-border bg-surface p-1 rounded-md",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none transition-colors",
        "hover:bg-surface-hover focus:bg-surface-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-30",
        className
      )}
      {...props}
    />
  )
}

function MenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/menu.tsx
git commit -m "feat: migrate DropdownMenu to Base UI Menu"
```

---

## Task 14: Migrate Select Component

**Files:**
- Modify: `packages/ui/src/components/select.tsx`

- [ ] **Step 1: Rewrite select.tsx**

```tsx
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CaretUpDownIcon } from "@phosphor-icons/react"

import { cn } from "../lib/utils"

const Select = SelectPrimitive.Root
const SelectValue = SelectPrimitive.Value

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between border border-input bg-background px-3 text-sm text-foreground rounded-md",
        "focus:outline-none focus:ring-2 focus:ring-border-focus focus:border-border-focus",
        "disabled:cursor-not-allowed disabled:opacity-30",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <CaretUpDownIcon weight="light" className="h-4 w-4 text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectPopup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner>
        <SelectPrimitive.Popup
          className={cn(
            "ss-select-popup z-50 max-h-72 min-w-[8rem] overflow-auto border border-dashed border-border bg-surface p-1 rounded-md",
            className
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm text-foreground outline-none",
        "focus:bg-surface-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectValue, SelectTrigger, SelectPopup, SelectItem }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/select.tsx
git commit -m "feat: migrate Select to Base UI"
```

---

## Task 15: Migrate Field Component (formerly FormField)

**Files:**
- Rename: `packages/ui/src/components/form-field.tsx` → `packages/ui/src/components/field.tsx`

- [ ] **Step 1: Delete old file and create field.tsx**

```bash
rm packages/ui/src/components/form-field.tsx
```

Write `packages/ui/src/components/field.tsx`:

```tsx
import { Field as FieldPrimitive } from "@base-ui/react/field"

import { cn } from "../lib/utils"

interface FieldProps {
  label: string
  htmlFor?: string
  error?: string
  description?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

function Field({
  label,
  htmlFor,
  error,
  description,
  required,
  className,
  children,
}: FieldProps) {
  return (
    <FieldPrimitive.Root className={cn("space-y-1.5", className)} invalid={!!error}>
      <FieldPrimitive.Label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-foreground"
      >
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </FieldPrimitive.Label>
      {children}
      {error ? (
        <FieldPrimitive.Error className="text-xs text-destructive">
          {error}
        </FieldPrimitive.Error>
      ) : description ? (
        <FieldPrimitive.Description className="text-xs text-muted">
          {description}
        </FieldPrimitive.Description>
      ) : null}
    </FieldPrimitive.Root>
  )
}

export { Field }
export type { FieldProps }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/field.tsx
git commit -m "feat: migrate FormField to Base UI Field"
```

---

## Task 16: Migrate Input Component

**Files:**
- Modify: `packages/ui/src/components/input.tsx`

- [ ] **Step 1: Rewrite input.tsx**

```tsx
import { Input as InputPrimitive } from "@base-ui/react/input"
import { type ReactNode, forwardRef } from "react"

import { cn } from "../lib/utils"

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  suffix?: ReactNode
  wrapperClassName?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, suffix, wrapperClassName, ...props }, ref) => {
    return (
      <div className={cn("relative", wrapperClassName)}>
        <InputPrimitive
          ref={ref}
          className={cn(
            "h-9 w-full border border-input bg-background px-3 text-sm text-foreground rounded-md",
            "placeholder:text-muted",
            "focus:outline-none focus:ring-2 focus:ring-border-focus focus:border-border-focus",
            "disabled:cursor-not-allowed disabled:opacity-30",
            error && "border-destructive focus:ring-destructive/20",
            suffix && "pr-10",
            className
          )}
          {...props}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
            {suffix}
          </div>
        )}
      </div>
    )
  }
)

Input.displayName = "Input"

export { Input }
export type { InputProps }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/input.tsx
git commit -m "feat: migrate Input to Base UI"
```

---

## Task 17: Migrate Progress Component

**Files:**
- Modify: `packages/ui/src/components/progress.tsx`

- [ ] **Step 1: Rewrite progress.tsx**

```tsx
import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "../lib/utils"

type ProgressVariant = "default" | "success" | "warning" | "destructive"

const barClasses: Record<ProgressVariant, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
}

interface ProgressProps {
  value: number
  max?: number
  variant?: ProgressVariant
  className?: string
}

function Progress({
  value,
  max = 100,
  variant = "default",
  className,
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <ProgressPrimitive.Root value={value} max={max} className={cn("w-full", className)}>
      <ProgressPrimitive.Track className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
        <ProgressPrimitive.Indicator
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            barClasses[variant]
          )}
          style={{ width: `${percentage}%` }}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
export type { ProgressProps, ProgressVariant }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/progress.tsx
git commit -m "feat: migrate Progress to Base UI"
```

---

## Task 18: Update Confirm Dialog

**Files:**
- Modify: `packages/ui/src/components/confirm-dialog.tsx`

- [ ] **Step 1: Update imports in confirm-dialog.tsx**

This component uses Dialog internally. Update it to use the new Dialog exports (`DialogPopup` instead of `DialogContent`). The Motion usage for the spinner animation stays — it's not a Base UI component.

Update the import line from:
```tsx
import { Dialog, DialogContent, DialogDescription, ... } from "./dialog"
```
To:
```tsx
import { Dialog, DialogPopup, DialogDescription, ... } from "./dialog"
```

And replace `<DialogContent>` with `<DialogPopup>` in the JSX. Keep all Motion usage for the spinner animation intact.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/confirm-dialog.tsx
git commit -m "feat: update ConfirmDialog to use new Dialog exports"
```

---

## Task 19: Update Barrel Exports

**Files:**
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Rewrite index.ts**

```tsx
// Accordion
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "./components/accordion"

// Alert
export { type AlertVariant, Alert } from "./components/alert"

// Avatar
export { type AvatarSize, Avatar } from "./components/avatar"

// Badge
export { type BadgeVariant, Badge } from "./components/badge"

// Breadcrumbs
export {
  type BreadcrumbItem,
  type BreadcrumbsProps,
  Breadcrumbs,
} from "./components/breadcrumbs"

// Button
export { Button, buttonVariants } from "./components/button"

// Card
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/card"

// Checkbox
export { Checkbox } from "./components/checkbox"

// Confirm Dialog
export { ConfirmDialog } from "./components/confirm-dialog"

// Dialog
export {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "./components/dialog"

// Field (formerly FormField)
export { Field } from "./components/field"

// Input
export { Input } from "./components/input"

// Kbd
export { Kbd } from "./components/kbd"

// Menu (formerly DropdownMenu)
export {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuSeparator,
} from "./components/menu"

// Popover
export { Popover, PopoverTrigger, PopoverPopup } from "./components/popover"

// Progress
export { type ProgressVariant, Progress } from "./components/progress"

// Radio
export { RadioGroup, RadioGroupItem } from "./components/radio"

// Select
export {
  Select,
  SelectValue,
  SelectTrigger,
  SelectPopup,
  SelectItem,
} from "./components/select"

// Separator
export { Separator } from "./components/separator"

// Skeleton
export { Skeleton } from "./components/skeleton"

// Switch
export { Switch } from "./components/switch"

// Table
export {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/table"

// Tabs
export { Tabs, TabsList, TabsTab, TabsPanel } from "./components/tabs"

// Textarea
export { Textarea } from "./components/textarea"

// Toast
export {
  type ToastVariant,
  type ToastAction,
  type Toast,
  ToastProvider,
  useToast,
} from "./components/toast"

// Tooltip
export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
} from "./components/tooltip"

// Utils
export { cn } from "./lib/utils"
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/index.ts
git commit -m "feat: update barrel exports for Base UI migration"
```

---

## Task 20: Update Console App — Layout and Shell Files

**Files:**
- Modify: `apps/console/src/app/layout.tsx`
- Modify: `apps/console/src/components/layout/dashboard-shell.tsx`

- [ ] **Step 1: Update layout.tsx**

No changes needed — `ToastProvider` and `cn` export names are unchanged.

- [ ] **Step 2: Update dashboard-shell.tsx**

No changes needed — `TooltipProvider` and `cn` export names are unchanged.

- [ ] **Step 3: Commit** (if changes were needed)

---

## Task 21: Update Console App — Sidebar Files

**Files:**
- Modify: `apps/console/src/components/sidebar/sidebar.tsx`
- Modify: `apps/console/src/components/sidebar/sidebar-nav.tsx`
- Modify: `apps/console/src/components/sidebar/sidebar-user-menu.tsx`

- [ ] **Step 1: Update sidebar.tsx**

Change imports:
```tsx
// Before
import { Button, cn, Kbd, Separator, Tooltip, TooltipContent, TooltipTrigger } from "@superserve/ui"

// After
import { Button, cn, Kbd, Separator, Tooltip, TooltipPopup, TooltipTrigger } from "@superserve/ui"
```

Replace all `<TooltipContent` with `<TooltipPopup`. Replace `asChild` on TooltipTrigger with `render` prop:

```tsx
// Before
<TooltipTrigger asChild>
  <Button ...>...</Button>
</TooltipTrigger>

// After
<TooltipTrigger render={<Button ... />}>
  ...
</TooltipTrigger>
```

- [ ] **Step 2: Update sidebar-nav.tsx**

Change imports:
```tsx
// Before
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@superserve/ui"

// After
import { cn, Tooltip, TooltipPopup, TooltipTrigger } from "@superserve/ui"
```

Replace `<TooltipContent` with `<TooltipPopup`. Replace `asChild` on TooltipTrigger with `render` prop:

```tsx
// Before
<TooltipTrigger asChild>
  <Link ...>...</Link>
</TooltipTrigger>

// After
<TooltipTrigger render={<Link ... />}>
  ...
</TooltipTrigger>
```

- [ ] **Step 3: Update sidebar-user-menu.tsx**

Change imports:
```tsx
// Before
import { Avatar, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@superserve/ui"

// After
import { Avatar, cn, Menu, MenuPopup, MenuItem, MenuSeparator, MenuTrigger } from "@superserve/ui"
```

Replace all component names in JSX:
- `<DropdownMenu>` → `<Menu>`
- `<DropdownMenuTrigger asChild>` → `<MenuTrigger render={<button ... />}>`
- `<DropdownMenuContent side="right" align="start" className="w-56">` → `<MenuPopup className="w-56">`
- `<DropdownMenuItem>` → `<MenuItem>`
- `<DropdownMenuSeparator>` → `<MenuSeparator>`

Note: `side` and `align` props are handled internally by `MenuPopup`'s Positioner. If specific placement is needed, pass it to the Positioner within the `MenuPopup` component.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/sidebar/
git commit -m "feat: update sidebar components for Base UI migration"
```

---

## Task 22: Update Console App — Dialog Usages

**Files:**
- Modify: `apps/console/src/app/(dashboard)/api-keys/page.tsx`
- Modify: `apps/console/src/app/(dashboard)/settings/page.tsx`
- Modify: `apps/console/src/components/sandboxes/create-sandbox-dialog.tsx`

- [ ] **Step 1: Update api-keys/page.tsx**

Change imports — replace `DialogContent` with `DialogPopup`, `DropdownMenu*` with `Menu*`, `FormField` with `Field`:

```tsx
// Before
import { Alert, Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, FormField, Input, Table, TableCell, TableHead, TableHeader, TableRow, useToast } from "@superserve/ui"

// After
import { Alert, Button, Checkbox, Dialog, DialogPopup, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Input, Menu, MenuPopup, MenuItem, MenuSeparator, MenuTrigger, Table, TableCell, TableHead, TableHeader, TableRow, useToast } from "@superserve/ui"
```

In JSX:
- `<DialogContent>` → `<DialogPopup>`
- `<DialogTrigger asChild>` → `<DialogTrigger render={<Button ... />}>`
- `<FormField label="...">` → `<Field label="...">`
- `<DropdownMenu>` → `<Menu>`, `<DropdownMenuTrigger asChild>` → `<MenuTrigger render={<Button ... />}>`, etc.
- All `asChild` patterns on Button → `render` prop

- [ ] **Step 2: Update settings/page.tsx**

Same pattern — replace `DialogContent` with `DialogPopup`, `FormField` with `Field`.

- [ ] **Step 3: Update create-sandbox-dialog.tsx**

Change imports:
```tsx
// Before
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, FormField, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@superserve/ui"

// After
import { Button, Dialog, DialogPopup, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Input, Select, SelectPopup, SelectItem, SelectTrigger, SelectValue } from "@superserve/ui"
```

In JSX:
- `<DialogContent>` → `<DialogPopup>`
- `<DialogTrigger asChild>` → `<DialogTrigger render={<Button ... />}>`
- `<FormField>` → `<Field>`
- `<SelectContent>` → `<SelectPopup>`

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/app/\(dashboard\)/api-keys/page.tsx apps/console/src/app/\(dashboard\)/settings/page.tsx apps/console/src/components/sandboxes/create-sandbox-dialog.tsx
git commit -m "feat: update dialog and form usages for Base UI migration"
```

---

## Task 23: Update Console App — Table Pages

**Files:**
- Modify: `apps/console/src/app/(dashboard)/sandboxes/page.tsx`
- Modify: `apps/console/src/app/(dashboard)/snapshots/page.tsx`
- Modify: `apps/console/src/app/(dashboard)/audit-logs/page.tsx`

- [ ] **Step 1: Update sandboxes/page.tsx**

Change imports — replace `DropdownMenu*` with `Menu*`:
```tsx
// Before
import { Badge, type BadgeVariant, Button, Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Table, TableCell, TableHead, TableHeader, TableRow } from "@superserve/ui"

// After
import { Badge, type BadgeVariant, Button, Checkbox, Menu, MenuPopup, MenuItem, MenuSeparator, MenuTrigger, Table, TableCell, TableHead, TableHeader, TableRow } from "@superserve/ui"
```

In JSX: rename all `DropdownMenu*` to `Menu*`, replace `asChild` with `render` prop.

- [ ] **Step 2: Update snapshots/page.tsx and audit-logs/page.tsx**

These only use `Button`, `Checkbox`, `Badge`, `Table*` — no Radix-specific changes needed. Verify imports are correct.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/\(dashboard\)/sandboxes/page.tsx apps/console/src/app/\(dashboard\)/snapshots/page.tsx apps/console/src/app/\(dashboard\)/audit-logs/page.tsx
git commit -m "feat: update table pages for Base UI migration"
```

---

## Task 24: Update Console App — Auth Pages

**Files:**
- Modify: `apps/console/src/app/(auth)/auth/signup/page.tsx`
- Modify: `apps/console/src/app/(auth)/auth/signin/page.tsx`
- Modify: `apps/console/src/app/(auth)/auth/reset-password/page.tsx`
- Modify: `apps/console/src/app/(auth)/auth/forgot-password/page.tsx`
- Modify: `apps/console/src/app/(auth)/auth/auth-code-error/page.tsx`

- [ ] **Step 1: Update auth-code-error/page.tsx**

This uses `Button` with `asChild` wrapping a Link:
```tsx
// Before
<Button asChild><Link href="...">...</Link></Button>

// After
<Button render={<Link href="..." />}>...</Button>
```

- [ ] **Step 2: Update signup, signin, reset-password, forgot-password pages**

These use `Button`, `Input`, `useToast`, `Badge` — no Radix-specific API changes. Verify imports compile.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/\(auth\)/
git commit -m "feat: update auth pages for Base UI migration"
```

---

## Task 25: Update Console App — Remaining Components

**Files:**
- Modify: `apps/console/src/components/error-state.tsx`
- Modify: `apps/console/src/components/empty-state.tsx`
- Modify: `apps/console/src/components/table-toolbar.tsx`
- Modify: `apps/console/src/components/onboarding/step-playground.tsx`
- Modify: `apps/console/src/components/onboarding/step-deploy.tsx`
- Modify: `apps/console/src/components/onboarding/step-install.tsx`
- Modify: `apps/console/src/app/(public)/device/page.tsx`
- Modify: `apps/console/src/app/(dashboard)/get-started/page.tsx`

- [ ] **Step 1: Update all files**

Most of these use `Button`, `cn`, `Badge`, `Card`, `Alert`, `Input` — exports unchanged. Scan for any `asChild` usage and replace with `render` prop. No other API changes needed.

- [ ] **Step 2: Files using only `cn`**

These need no changes:
- `apps/console/src/components/table-skeleton.tsx`
- `apps/console/src/components/sticky-hover-table.tsx`
- `apps/console/src/components/step-indicator.tsx`
- `apps/console/src/components/corner-brackets.tsx`
- `apps/console/src/components/framework-picker.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/components/ apps/console/src/app/\(public\)/ apps/console/src/app/\(dashboard\)/get-started/
git commit -m "feat: update remaining console components for Base UI migration"
```

---

## Task 26: Update UI Docs App

**Files:**
- Modify: `apps/ui-docs/src/app.tsx`
- Modify: All files in `apps/ui-docs/src/examples/`

- [ ] **Step 1: Update app.tsx**

No changes needed — `ToastProvider` and `TooltipProvider` export names are unchanged.

- [ ] **Step 2: Update example files**

For each example file that uses renamed exports:

- `dropdown-menu.tsx` → Update imports to `Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator`. Update all JSX. Replace `asChild` with `render`.
- `dialog.tsx` → Replace `DialogContent` with `DialogPopup`. Replace `asChild` with `render`.
- `confirm-dialog.tsx` → Verify it still works (uses ConfirmDialog which was updated internally).
- `select.tsx` → Replace `SelectContent` with `SelectPopup`.
- `tabs.tsx` → Replace `TabsTrigger` with `TabsTab`, `TabsContent` with `TabsPanel`.
- `tooltip.tsx` → Replace `TooltipContent` with `TooltipPopup`. Replace `asChild` with `render`.
- `popover.tsx` → Replace `PopoverContent` with `PopoverPopup`. Replace `asChild` with `render`.
- `accordion.tsx` → Replace `AccordionContent` with `AccordionPanel`.
- `form-field.tsx` → Rename file/example to `field.tsx`. Replace `FormField` with `Field`.
- `radio-group.tsx` → Verify RadioGroup/RadioGroupItem still work (names unchanged).
- `checkbox.tsx`, `switch.tsx`, `avatar.tsx`, `progress.tsx`, `input.tsx` → Verify examples compile.

All other example files (badge, card, alert, toast, breadcrumbs, textarea, table, separator, skeleton, kbd) use custom components with no API changes.

- [ ] **Step 3: Update the component registry/meta**

If the ui-docs app has a component list or routing config that references old component names (e.g. "dropdown-menu", "form-field"), update those to "menu" and "field".

- [ ] **Step 4: Commit**

```bash
git add apps/ui-docs/
git commit -m "feat: update ui-docs examples for Base UI migration"
```

---

## Task 27: Clean Up Old Files

**Files:**
- Delete: `packages/ui/src/components/dropdown-menu.tsx` (if not already deleted)
- Delete: `packages/ui/src/components/radio-group.tsx` (if not already deleted)
- Delete: `packages/ui/src/components/form-field.tsx` (if not already deleted)

- [ ] **Step 1: Verify old files are removed**

```bash
ls packages/ui/src/components/dropdown-menu.tsx packages/ui/src/components/radio-group.tsx packages/ui/src/components/form-field.tsx 2>&1
```

Expected: "No such file or directory" for all three.

- [ ] **Step 2: Verify no stale imports remain**

```bash
cd /Users/nirnejak/Code/superserve/superserve
grep -r "@radix-ui" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No Radix imports found"
grep -r "DropdownMenu" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No DropdownMenu references found"
grep -r "FormField" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No FormField references found"
grep -r "DialogContent" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No DialogContent references found"
grep -r "TabsContent\b" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No TabsContent references found"
grep -r "TabsTrigger\b" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No TabsTrigger references found"
grep -r "TooltipContent" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No TooltipContent references found"
grep -r "PopoverContent" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No PopoverContent references found"
grep -r "SelectContent" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No SelectContent references found"
grep -r "AccordionContent" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No AccordionContent references found"
grep -r "asChild" packages/ui/src/ apps/console/src/ apps/ui-docs/src/ || echo "No asChild references found"
```

Expected: All return "not found".

- [ ] **Step 3: Commit cleanup if needed**

```bash
git add -A
git commit -m "chore: remove stale Radix UI references"
```

---

## Task 28: Verify Build and Types

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/nirnejak/Code/superserve/superserve
bunx turbo run typecheck
```

Expected: All projects pass type checking.

- [ ] **Step 2: Run lint**

```bash
bunx turbo run lint
```

Expected: No lint errors. Fix any unused import warnings.

- [ ] **Step 3: Run build**

```bash
bunx turbo run build
```

Expected: All projects build successfully.

- [ ] **Step 4: Fix any errors found**

Address type errors, missing imports, or build failures. Common issues:
- Props that changed names (e.g. `onCheckedChange` vs `onValueChange`)
- Missing re-exports in index.ts
- CSS class conflicts

- [ ] **Step 5: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve type and build errors from Base UI migration"
```

---

## Task 29: Visual Verification

- [ ] **Step 1: Start ui-docs dev server**

```bash
cd /Users/nirnejak/Code/superserve/superserve
bunx turbo run dev --filter=@superserve/ui-docs
```

Manually verify each component renders correctly:
- Accordion opens/closes with smooth animation
- Avatar shows image and fallback
- Button all variants render correctly, `render` prop works
- Checkbox check animation is smooth
- Dialog opens with fade+scale, closes smoothly, backdrop works
- Menu opens on trigger click, items highlight on hover
- Popover opens with animation
- Radio selection indicator animates
- Select dropdown opens, items selectable
- Switch toggles smoothly
- Tabs switch content with correct active state
- Tooltip appears on hover with animation
- Field shows label, error, description correctly
- Progress bar renders with correct variant colors

- [ ] **Step 2: Start console dev server**

```bash
bunx turbo run dev --filter=@superserve/console
```

Test key flows:
- Sidebar tooltips and user menu
- Create sandbox dialog (Dialog + Select + Field)
- API keys page (Dialog + Menu + Field)
- Settings page (Dialog + Field + Input)
- Auth pages (Input + Button)

- [ ] **Step 3: Fix any visual issues and commit**

```bash
git add -A
git commit -m "fix: visual adjustments for Base UI components"
```

---

## Task 30: Final Cleanup

- [ ] **Step 1: Verify no Radix packages remain in lockfile**

```bash
cat packages/ui/package.json | grep -i radix || echo "No Radix in package.json"
```

Expected: No Radix references.

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore: complete Radix UI to Base UI migration"
```
