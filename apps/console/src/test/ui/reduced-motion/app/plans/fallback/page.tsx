"use client"

import { useEffect, useState } from "react"

import ChoosePlanPage from "@/app/(auth)/auth/choose-plan/page"

import { FixtureShell } from "../../fixture-shell"

// The real choose-plan page. Its useSearchParams is replaced
// (navigation-stub.ts) with one that never resolves, so the page's real
// Suspense fallback stays on screen. Mounted after hydration: during
// server rendering the never-resolving read would keep the response open.
export default function Page() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (
    <FixtureShell>
      <div
        className="relative flex-1 overflow-hidden"
        data-testid="fallback-host"
      >
        {mounted ? <ChoosePlanPage /> : null}
      </div>
    </FixtureShell>
  )
}
