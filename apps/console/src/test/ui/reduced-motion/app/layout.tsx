import { cn } from "@superserve/ui"
import type { ReactNode } from "react"

import { MotionProvider } from "@/components/motion-provider"

import "./globals.css"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("dark")}>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  )
}
