"use client"

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
    <FieldPrimitive.Root
      className={cn("space-y-1.5", className)}
      invalid={!!error}
    >
      <FieldPrimitive.Label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-foreground"
      >
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </FieldPrimitive.Label>
      {children}
      {error ? (
        // Shown whenever an error is passed, not only when the browser's own
        // validation fails, which never happens for the checks callers make.
        <FieldPrimitive.Error match className="text-xs text-destructive">
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

export type { FieldProps }
export { Field }
