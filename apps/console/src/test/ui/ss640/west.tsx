"use client"

import { ToastProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { TeamsSection } from "../../../components/settings/teams-section"
import { TeamSwitcher } from "../../../components/sidebar/team-switcher"

export function West() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  )
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <main className="min-h-screen p-8">
          <TeamSwitcher />
          <TeamsSection />
        </main>
      </ToastProvider>
    </QueryClientProvider>
  )
}
