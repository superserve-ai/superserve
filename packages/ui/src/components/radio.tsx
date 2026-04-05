"use client"

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
    <RadioGroupPrimitive className={cn("grid gap-3", className)} {...props} />
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
          "peer relative h-4 w-4 shrink-0 rounded-full border border-input transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          "disabled:cursor-not-allowed disabled:opacity-30",
          "data-[checked]:border-primary",
          className,
        )}
        {...props}
      >
        <RadioPrimitive.Indicator className="ss-radio-indicator absolute inset-0 flex items-center justify-center">
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
