"use client"

import { useEffect, useState } from "react"
import { ensureDashboardApiKeyAction } from "@/lib/api/api-keys-actions"
import { setApiKey } from "@/lib/api/client"

export function ApiKeyProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("superserve-api-key")
    if (stored) {
      setReady(true)
      return
    }

    ensureDashboardApiKeyAction()
      .then((key) => {
        if (key) {
          setApiKey(key)
        }
      })
      .catch((err) => {
        console.error("Failed to provision API key:", err)
      })
      .finally(() => {
        setReady(true)
      })
  }, [])

  if (!ready) return null

  return <>{children}</>
}
