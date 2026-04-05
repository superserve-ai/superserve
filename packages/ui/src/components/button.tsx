import { cloneElement, type ReactElement } from "react"

import { cn } from "../lib/utils"

type ButtonVariant = "default" | "destructive" | "outline" | "ghost" | "link"
type ButtonSize = "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg"

const baseClasses =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-mono font-medium uppercase transition-colors disabled:pointer-events-none disabled:opacity-30 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus aria-invalid:ring-destructive/20 aria-invalid:ring-2"

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-primary text-background hover:bg-primary-hover",
  destructive:
    "bg-destructive text-foreground hover:bg-destructive-hover focus-visible:ring-destructive/20",
  outline:
    "border border-dashed border-border bg-background hover:bg-surface-hover hover:text-foreground",
  ghost: "hover:bg-surface-hover hover:text-foreground",
  link: "text-primary underline-offset-4 hover:underline normal-case font-sans",
}

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-6",
  sm: "h-8 px-4 gap-1.5",
  lg: "h-10 px-8",
  icon: "size-9",
  "icon-sm": "size-8",
  "icon-lg": "size-10",
}

function buttonVariants({
  variant = "default",
  size = "default",
}: {
  variant?: ButtonVariant
  size?: ButtonSize
} = {}) {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size])
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  render?: ReactElement
}

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className)

  if (render) {
    const renderProps = render.props as Record<string, unknown>
    return cloneElement(render as React.ReactElement<Record<string, unknown>>, {
      ...props,
      className: cn(classes, renderProps.className as string | undefined),
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
