"use client"

import { cn } from "@superserve/ui"
import { motion } from "motion/react"
import {
  Children,
  cloneElement,
  isValidElement,
  useRef,
  useState,
} from "react"

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

  const handleRowMouseEnter = (e: React.MouseEvent<HTMLTableRowElement>) => {
    if (!tbodyRef.current) return
    const tbodyRect = tbodyRef.current.getBoundingClientRect()
    const rowRect = e.currentTarget.getBoundingClientRect()
    setHoverStyle({
      top: rowRect.top - tbodyRect.top,
      height: rowRect.height,
    })
  }

  return (
    <tbody
      ref={tbodyRef}
      className={cn("relative [&_tr:last-child]:border-0", className)}
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
          aria-hidden
        >
          <td style={{ padding: 0, border: 0 }}>
            <motion.div
              className="absolute left-0 right-0 bg-white/4"
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
      {Children.map(children, (child) => {
        if (!isValidElement<React.HTMLAttributes<HTMLTableRowElement>>(child))
          return child
        return cloneElement(child, {
          onMouseEnter: (e: React.MouseEvent<HTMLTableRowElement>) => {
            handleRowMouseEnter(e)
            child.props.onMouseEnter?.(e)
          },
          className: cn(
            "border-b border-border transition-colors",
            child.props.className,
          ),
        })
      })}
    </tbody>
  )
}
