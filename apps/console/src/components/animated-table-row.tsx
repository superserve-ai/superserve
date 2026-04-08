"use client"

import { cn } from "@superserve/ui"
import { type HTMLMotionProps, motion } from "motion/react"

type AnimatedTableRowProps = HTMLMotionProps<"tr">

export function AnimatedTableRow({
  className,
  children,
  ...props
}: AnimatedTableRowProps) {
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        layout: { type: "spring", bounce: 0.15, duration: 0.4 },
        opacity: { duration: 0.15, ease: "easeInOut" },
      }}
      className={cn("border-b border-border transition-colors", className)}
      {...props}
    >
      {children}
    </motion.tr>
  )
}
