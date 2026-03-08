"use client"

import { useEffect, useState } from "react"
import { createBrowserClient } from "@superserve/supabase"

export interface Agent {
  id: string
  name: string
  created_at: string
}

export function useAgents(enabled: boolean) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const supabase = createBrowserClient()
    let cancelled = false
    let userId: string | null = null

    const fetchAgents = async () => {
      if (!userId) {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || cancelled) return
        userId = user.id
      }

      const { data } = await supabase
        .from("agents")
        .select("id, name, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })

      if (!cancelled && data) {
        setAgents(data)
      }
      setLoading(false)
    }

    const setupRealtimeAndFetch = async () => {
      setLoading(true)
      await fetchAgents()
      if (cancelled || !userId) return

      const channel = supabase
        .channel("agents-realtime")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "agents",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            fetchAgents()
          },
        )
        .subscribe()

      cleanupChannel = () => supabase.removeChannel(channel)
    }

    let cleanupChannel: (() => void) | null = null
    setupRealtimeAndFetch()

    return () => {
      cancelled = true
      cleanupChannel?.()
    }
  }, [enabled])

  return { agents, loading, hasAgents: agents.length > 0 }
}
