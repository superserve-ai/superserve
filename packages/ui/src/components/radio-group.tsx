"use client"

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { motion } from "motion/react"
import { cn } from "../lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

interface RadioGroupItemProps
  extends React.ComponentProps<typeof RadioGroupPrimitive.Item> {
  label?: string
}

function RadioGroupItem({
  className,
  label,
  id,
  ...props
}: RadioGroupItemProps) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupPrimitive.Item
        id={id}
        className={cn(
          "h-4 w-4 shrink-0 border border-input transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:border-primary",
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          <motion.div
            className="h-2 w-2 bg-primary"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.1 }}
          />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      {label && (
        <label
          htmlFor={id}
          className="text-sm text-foreground cursor-pointer select-none"
        >
          {label}
        </label>
      )}
    </div>
  )
}

export { RadioGroup, RadioGroupItem }
