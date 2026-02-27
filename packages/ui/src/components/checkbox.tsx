"use client"

import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "../lib/utils"

interface CheckboxProps
  extends React.ComponentProps<typeof CheckboxPrimitive.Root> {
  label?: string
}

function Checkbox({ className, label, id, ...props }: CheckboxProps) {
  return (
    <div className="flex items-center gap-2">
      <CheckboxPrimitive.Root
        id={id}
        className={cn(
          "peer h-4 w-4 shrink-0 border border-input transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:bg-primary data-[state=checked]:border-primary",
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <AnimatePresence>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.1 }}
            >
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </motion.div>
          </AnimatePresence>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
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

export { Checkbox }
