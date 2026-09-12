"use client"

import { notFound } from "next/navigation"

import { useQmAccess } from "@/hooks/use-qm-access"

/**
 * Hides the QM section from anyone outside the beta. A direct URL gets the
 * standard 404 rather than a "coming soon" page, so the section's existence
 * isn't advertised. Renders nothing while the decision is still loading to
 * avoid flashing a page that is about to 404.
 */
export function QmGate({ children }: { children: React.ReactNode }) {
  const { enabled, loading } = useQmAccess()
  if (enabled) return <>{children}</>
  if (loading) return null
  notFound()
}
