"use client"

import { ToastProvider, TooltipProvider } from "@superserve/ui"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import { PlanUsagePageClient } from "../../../../../app/(dashboard)/plan-usage/page-client"
import SettingsPage from "../../../../../app/(dashboard)/settings/page"
import { QueryProvider } from "../../../../../components/query-provider"
import { fixtureCookie, isScenario, type Scenario } from "../../fixtures"

export default function Page() {
  const path = usePathname().replace(/\/$/, "")
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    const selected =
      new URLSearchParams(window.location.search).get("scenario") ??
      sessionStorage.getItem(fixtureCookie) ??
      "tracked"
    if (!isScenario(selected)) {
      setInvalid(true)
      return
    }
    // Set the scenario before mounting hooks: the first API request must use it.
    sessionStorage.setItem(fixtureCookie, selected)
    document.cookie = `${fixtureCookie}=${selected}; Path=/; SameSite=Strict`
    setScenario(selected)
  }, [])

  if (invalid) return <p>Unknown billing fixture</p>
  if (!scenario) return <p>Loading local billing fixture…</p>
  if (path !== "/settings" && path !== "/plan-usage")
    return <p>Unknown fixture route</p>
  return (
    <QueryProvider key={scenario}>
      <ToastProvider>
        <TooltipProvider>
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <aside className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted">
              Local UI fixture · {scenario} · simulated services
            </aside>
            <main className="flex min-h-0 flex-1 flex-col">
              {path === "/settings" ? (
                <SettingsPage />
              ) : (
                <PlanUsagePageClient />
              )}
            </main>
          </div>
        </TooltipProvider>
      </ToastProvider>
    </QueryProvider>
  )
}
