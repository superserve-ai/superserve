"use client"

import type { ReactNode } from "react"

export function SyntheticBrowserDependencies({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
