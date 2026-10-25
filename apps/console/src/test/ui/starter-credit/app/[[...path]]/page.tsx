"use client"

import { ToastProvider, TooltipProvider } from "@superserve/ui"
import { useEffect, useState } from "react"

import { BuyCreditRoute } from "../../../../../app/(dashboard)/plan-usage/buy-credit/route-client"
import { QueryProvider } from "../../../../../components/query-provider"
import { fixtureCookie, isScenario, type Scenario } from "../../fixtures"

export default function Page() {
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    const selected =
      new URLSearchParams(window.location.search).get("scenario") ?? "first"
    if (!isScenario(selected)) {
      setInvalid(true)
      return
    }
    document.cookie = `${fixtureCookie}=${selected}; Path=/; SameSite=Strict`
    setScenario(selected)
  }, [])
  if (invalid) return <p>Unknown fixture</p>
  if (!scenario) return <p>Loading local fixture…</p>
  return (
    <QueryProvider key={scenario}>
      <ToastProvider>
        <TooltipProvider>
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <aside className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted">
              Local UI fixture · {scenario} · simulated services
            </aside>
            <main className="flex min-h-0 flex-1 flex-col">
              <BuyCreditRoute />
            </main>
          </div>
        </TooltipProvider>
      </ToastProvider>
    </QueryProvider>
  )
}
