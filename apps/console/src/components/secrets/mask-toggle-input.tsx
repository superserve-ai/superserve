"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { Input, type InputProps } from "@superserve/ui"
import { useState } from "react"

export function MaskToggleInput({
  onBlur,
  ...props
}: Omit<InputProps, "type" | "suffix">) {
  const [visible, setVisible] = useState(false)

  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      onBlur={(e) => {
        setVisible(false)
        onBlur?.(e)
      }}
      suffix={
        <button
          type="button"
          // Keep focus in the input so toggling doesn't trigger the blur re-mask.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
          className="cursor-pointer text-muted transition-colors hover:text-foreground"
          aria-label={visible ? "Hide value" : "Show value"}
        >
          {visible ? (
            <EyeSlashIcon className="size-4" weight="light" />
          ) : (
            <EyeIcon className="size-4" weight="light" />
          )}
        </button>
      }
    />
  )
}
