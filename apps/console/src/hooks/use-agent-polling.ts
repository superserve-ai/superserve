"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createBrowserClient } from "@superserve/supabase"

interface Agent {
  id: string
  name: string
  created_at: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ""
const POLL_INTERVAL = 10_000

export function useAgentPolling(enabled: boolean) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      const supabase = createBrowserClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const resp = await fetch(`${API_URL}/v1/agents?limit=100`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      })

      if (!resp.ok) return

      const data = await resp.json()
      const fetched: Agent[] = (data.agents ?? []).map(
        (a: Record<string, string>) => ({
          id: a.id,
          name: a.name,
          created_at: a.created_at,
        }),
      )
      setAgents(fetched)
    } catch {
      // Silently fail — polling will retry
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    setLoading(true)
    fetchAgents()

    intervalRef.current = setInterval(fetchAgents, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [enabled, fetchAgents])

  return { agents, loading, hasAgents: agents.length > 0 }
}
