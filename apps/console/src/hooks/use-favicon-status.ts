"use client"

import { useEffect } from "react"
import { useSandboxes } from "./use-sandboxes"

const DEFAULT_FAVICON = "/favicon.ico"
const ACTIVE_FAVICON = "/favicon-active.ico"

export function useFaviconStatus() {
  const { data: sandboxes } = useSandboxes()

  useEffect(() => {
    const hasTransitional = sandboxes?.some((s) => s.status === "pausing")

    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
    if (!link) return

    link.href = hasTransitional ? ACTIVE_FAVICON : DEFAULT_FAVICON
  }, [sandboxes])
}
