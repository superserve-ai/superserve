import { Slot } from "@radix-ui/react-slot"
import type * as React from "react"
import { cn } from "../lib/utils"

const buttonVariants = {
  variant: {
    default: "bg-primary text-white hover:bg-primary-hover",
    destructive:
      "bg-destructive text-white hover:bg-destructive-hover focus-visible:ring-destructive/20",
    outline:
      "border border-dashed border-border bg-background hover:bg-surface-hover hover:text-foreground",
    ghost: "hover:bg-surface-hover hover:text-foreground",
    link: "text-primary underline-offset-4 hover:underline normal-case font-sans tracking-normal",
  },
  size: {
    default: "h-9 px-6 py-2",
    sm: "h-8 gap-1.5 px-4",
    lg: "h-10 px-8",
    icon: "size-9",
    "icon-sm": "size-8",
    "icon-lg": "size-10",
  },
}

type ButtonVariant = keyof typeof buttonVariants.variant
type ButtonSize = keyof typeof buttonVariants.size

interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button"

  const baseClasses =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-mono font-medium uppercase transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-border-focus aria-invalid:ring-destructive/20 aria-invalid:border-destructive cursor-pointer"

  const variantClasses = buttonVariants.variant[variant]
  const sizeClasses = buttonVariants.size[size]

  return (
    <Comp
      data-slot="button"
      className={cn(baseClasses, variantClasses, sizeClasses, className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
