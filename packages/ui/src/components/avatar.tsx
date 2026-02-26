"use client"

import * as AvatarPrimitive from "@radix-ui/react-avatar"
import { cn } from "../lib/utils"

type AvatarSize = "xs" | "sm" | "default" | "lg"

const sizeClasses: Record<AvatarSize, string> = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-7 w-7 text-xs",
  default: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
}

interface AvatarProps
  extends React.ComponentProps<typeof AvatarPrimitive.Root> {
  src?: string
  alt?: string
  fallback: string
  size?: AvatarSize
}

function Avatar({
  className,
  src,
  alt,
  fallback,
  size = "default",
  ...props
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex shrink-0 overflow-hidden",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt={alt}
          className="aspect-square h-full w-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback className="flex h-full w-full items-center justify-center border border-border bg-surface font-mono text-muted uppercase">
        {fallback}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

export { Avatar }
export type { AvatarSize }
