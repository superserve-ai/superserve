"use client"

import { useVisitorData } from "@fingerprint/react"
import { useEffect } from "react"

import { registerFingerprintGetData } from "@/lib/fingerprint/client"

/**
 * Register the agent; signup submission owns capture so a long-lived form
 * does not age the event past its initial verification window.
 */
export function FingerprintSignupObserver() {
  if (!process.env.NEXT_PUBLIC_FINGERPRINT_API_KEY) return null

  return <FingerprintSignupObserverEnabled />
}

function FingerprintSignupObserverEnabled() {
  const { getData } = useVisitorData({ immediate: false })

  useEffect(() => {
    registerFingerprintGetData(getData)
  }, [getData])

  return null
}
