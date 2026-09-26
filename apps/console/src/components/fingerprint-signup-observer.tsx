"use client"

import { useVisitorData } from "@fingerprint/react"
import { usePathname } from "next/navigation"
import { useEffect } from "react"

import {
  ensureFingerprintSignupCapture,
  registerFingerprintGetData,
} from "@/lib/fingerprint/client"

/**
 * Observe the signup page without coupling signup availability to Fingerprint.
 * Only the opaque event ID crosses the client/server boundary; trusted device
 * and Smart Signal data is fetched by the server from Fingerprint.
 */
export function FingerprintSignupObserver() {
  if (!process.env.NEXT_PUBLIC_FINGERPRINT_API_KEY) return null

  return <FingerprintSignupObserverEnabled />
}

function FingerprintSignupObserverEnabled() {
  const pathname = usePathname()
  const { getData } = useVisitorData({ immediate: false })

  useEffect(() => {
    registerFingerprintGetData(getData)
  }, [getData])

  useEffect(() => {
    const normalizedPathname = pathname.replace(/\/+$/, "")
    if (normalizedPathname !== "/auth/signup") return

    void ensureFingerprintSignupCapture()
  }, [getData, pathname])

  return null
}
