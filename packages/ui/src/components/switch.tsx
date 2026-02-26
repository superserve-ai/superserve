"use client"

import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cn } from "../lib/utils"

interface SwitchProps
  extends React.ComponentProps<typeof SwitchPrimitive.Root> {
  label?: string
}

function Switch({ className, label, id, ...props }: SwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <SwitchPrimitive.Root
        id={id}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer border-2 border-transparent transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 bg-background transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
      </SwitchPrimitive.Root>
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

export { Switch }
