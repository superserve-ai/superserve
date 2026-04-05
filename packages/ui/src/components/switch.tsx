"use client"

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
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
            "data-[checked]:translate-x-4 data-[unchecked]:translate-x-0",
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
