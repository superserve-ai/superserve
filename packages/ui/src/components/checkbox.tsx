"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "@phosphor-icons/react"

import { cn } from "../lib/utils"

interface CheckboxProps {
  checked?: boolean
  indeterminate?: boolean
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
          "peer h-4 w-4 shrink-0 border border-foreground/25 transition-colors",
          "focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-30",
          "data-[checked]:border-primary data-[checked]:bg-primary",
          className,
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
          className="cursor-pointer text-sm font-medium text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-30"
        >
          {label}
        </label>
      )}
    </div>
  )
}

export type { CheckboxProps }
export { Checkbox }
