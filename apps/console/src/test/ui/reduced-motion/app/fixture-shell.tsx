"use client"

import { ToastProvider, TooltipProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import Link from "next/link"
import { type ReactNode, useEffect, useState } from "react"

import { type FixtureMode, fixtureMode } from "../fixtures"

function setMode(mode: FixtureMode) {
  document.cookie = `fx=${mode}; path=/; max-age=3600`
  window.location.reload()
}

/** Fixture chrome: shows the active prefers-reduced-motion value and lets the
 *  viewer switch between loading and loaded data. Not part of Console. */
function Banner() {
  const [reduce, setReduce] = useState<boolean | null>(null)
  const [mode, setModeState] = useState<FixtureMode>("loaded")
  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    setModeState(fixtureMode())
  }, [])
  return (
    <aside className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2 text-xs text-muted">
      <span>Local UI fixture · production pages · fake API</span>
      <span
        data-testid="reduce-state"
        className={
          reduce
            ? "bg-brand/20 px-2 py-0.5 font-mono text-foreground"
            : "bg-surface-hover px-2 py-0.5 font-mono text-foreground"
        }
      >
        prefers-reduced-motion: reduce = {String(reduce)}
      </span>
      <span className="flex items-center gap-1">
        data:
        {(["loaded", "sections", "all"] as const).map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`mode-${m}`}
            onClick={() => setMode(m)}
            className={`px-2 py-0.5 ${mode === m ? "bg-foreground/15 text-foreground" : "hover:text-foreground"}`}
          >
            {m === "all"
              ? "loading"
              : m === "sections"
                ? "sections loading"
                : "loaded"}
          </button>
        ))}
      </span>
      <Link href="/sandboxes/" className="hover:text-foreground">
        list
      </Link>
      <Link href="/sandboxes/sbx-7f3a91c2/" className="hover:text-foreground">
        detail
      </Link>
    </aside>
  )
}

export function FixtureShell({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <Banner />
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          </div>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
