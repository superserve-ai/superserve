"use client"

import { Field as FieldPrimitive } from "@base-ui/react/field"
import { forwardRef } from "react"

import { cn } from "../lib/utils"

interface TextareaProps extends React.ComponentProps<"textarea"> {
  error?: string
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { className, error, id, name, disabled, value, defaultValue, ...props },
    ref,
  ) => {
    return (
      <FieldPrimitive.Control
        // Field.Control types its handlers for <input>, so textarea-only props go
        // on the rendered element; the props Field tracks go on the control.
        render={<textarea {...props} />}
        id={id}
        name={name}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        ref={ref}
        className={cn(
          "min-h-[80px] w-full border border-control bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted",
          "focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-30",
          "data-[invalid]:border-destructive",
          error && "border-destructive focus:border-destructive",
          className,
        )}
        {...(error ? { "aria-invalid": true as const } : {})}
      />
    )
  },
)
Textarea.displayName = "Textarea"

export type { TextareaProps }
export { Textarea }
