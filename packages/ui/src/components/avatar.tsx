"use client"

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "../lib/utils"

type AvatarSize = "xs" | "sm" | "default" | "lg"

const sizeClasses: Record<AvatarSize, string> = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-7 w-7 text-xs",
  default: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
}

interface AvatarProps {
  src?: string | null
  alt?: string
  fallback: string
  size?: AvatarSize
  className?: string
}

function Avatar({
  src,
  alt,
  fallback,
  size = "default",
  className,
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        sizeClasses[size],
        className,
      )}
    >
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt={alt}
          className="aspect-square h-full w-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback className="flex h-full w-full items-center justify-center bg-surface font-mono text-muted uppercase border border-dashed border-border rounded-full">
        {fallback}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

export { Avatar }
export type { AvatarProps, AvatarSize }
