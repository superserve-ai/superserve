"use client"

import { useEffect, useState } from "react"
import { getUser } from "@/lib/auth"
import { type Agent, getAgentsByUser, subscribeToAgentInserts } from "@/lib/db"

export type { Agent }

export function useAgents(enabled: boolean) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let userId: string | null = null

    const fetchAgents = async () => {
      if (!userId) {
        const user = await getUser()
        if (!user || cancelled) return
        userId = user.id
      }

      const data = await getAgentsByUser(userId)
      if (!cancelled) {
        setAgents(data)
      }
      setLoading(false)
    }

    const setupAndFetch = async () => {
      setLoading(true)
      await fetchAgents()
      if (cancelled || !userId) return

      // TODO(drizzle): subscribeToAgentInserts is a noop until
      // a realtime alternative is implemented
      cleanupSubscription = subscribeToAgentInserts(userId, () => {
        fetchAgents()
      })
    }

    let cleanupSubscription: (() => void) | null = null
    setupAndFetch()

    return () => {
      cancelled = true
      cleanupSubscription?.()
    }
  }, [enabled])

  return { agents, loading, hasAgents: agents.length > 0 }
}
