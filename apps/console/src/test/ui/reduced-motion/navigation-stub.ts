"use client"

import { use } from "react"

export * from "next/navigation"

const NEVER = new Promise<never>(() => {})

// Only the choose-plan page is routed here. The search params never resolve,
// so its real Suspense fallback stays on screen.
export function useSearchParams(): never {
  return use(NEVER)
}
