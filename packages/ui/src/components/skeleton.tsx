"use client"

import { motion } from "motion/react"
import { cn } from "../lib/utils"

function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div
      className={cn("bg-surface-hover", className)}
      animate={{ opacity: [0.5, 1, 0.5] }}
      transition={{
        duration: 1.5,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
      }}
    />
  )
}

export { Skeleton }
