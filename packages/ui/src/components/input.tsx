"use client"

import { Input as InputPrimitive } from "@base-ui/react/input"
import { forwardRef, type ReactNode } from "react"

import { cn } from "../lib/utils"

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
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
            "h-9 w-full border border-input bg-background px-3 text-sm text-foreground",
            "placeholder:text-muted",
            "focus:outline-none focus:ring-2 focus:ring-border-focus focus:border-border-focus",
            "disabled:cursor-not-allowed disabled:opacity-30",
            error && "border-destructive focus:ring-destructive/20",
            suffix && "pr-10",
            className,
          )}
          aria-invalid={!!error}
          {...props}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
            {suffix}
          </div>
        )}
      </div>
    )
  },
)

Input.displayName = "Input"

export type { InputProps }
export { Input }
