"use client"

import { cn } from "@superserve/ui"
import { AnimatePresence, motion } from "motion/react"
import { useRef, useState } from "react"

interface StickyHoverTableBodyProps {
  children: React.ReactNode
  className?: string
}

export function StickyHoverTableBody({
  children,
  className,
}: StickyHoverTableBodyProps) {
  const [hoverStyle, setHoverStyle] = useState<{
    top: number
    height: number
  } | null>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)

  const handleMouseOver = (e: React.MouseEvent<HTMLTableSectionElement>) => {
    const row = (e.target as HTMLElement).closest("tr")
    if (!row || !tbodyRef.current?.contains(row)) return
    // Skip the absolute-positioned hover indicator row
    if (row.getAttribute("aria-hidden") === "true") return
    const tbodyRect = tbodyRef.current.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    setHoverStyle({
      top: rowRect.top - tbodyRect.top,
      height: rowRect.height,
    })
  }

  return (
    <tbody
      ref={tbodyRef}
      className={cn("relative [&_tr:last-child]:border-0", className)}
      onMouseOver={handleMouseOver}
      onFocus={() => {}}
      onMouseLeave={() => setHoverStyle(null)}
    >
      {hoverStyle && (
        <motion.tr
          className="pointer-events-none !border-0"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 0,
            padding: 0,
            margin: 0,
          }}
          aria-hidden="true"
        >
          <td style={{ padding: 0, border: 0 }}>
            <motion.div
              className="absolute left-0 right-0 bg-foreground/4"
              animate={{
                y: hoverStyle.top,
                height: hoverStyle.height,
              }}
              transition={{
                type: "spring",
                bounce: 0.15,
                duration: 0.4,
              }}
            />
          </td>
        </motion.tr>
      )}
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </tbody>
  )
}
