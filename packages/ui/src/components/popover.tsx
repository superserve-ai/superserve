"use client"

import * as PopoverPrimitive from "@radix-ui/react-popover"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "../lib/utils"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal forceMount>
      <AnimatePresence>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={sideOffset}
          asChild
          {...props}
        >
          <motion.div
            className={cn(
              "z-50 min-w-[8rem] overflow-hidden border border-dashed border-border bg-surface p-4",
              className,
            )}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </PopoverPrimitive.Content>
      </AnimatePresence>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
