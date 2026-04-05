"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "../lib/utils"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

function PopoverPopup({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> & {
  sideOffset?: number
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner sideOffset={sideOffset}>
        <PopoverPrimitive.Popup
          className={cn(
            "ss-popover-popup z-50 min-w-[8rem] overflow-hidden border border-dashed border-border bg-surface p-4",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverPopup }
