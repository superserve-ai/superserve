"use client"

import { useEffect } from "react"

import { createBrowserClient } from "@/lib/supabase/client"

let signingOut = false

// Call before a deliberate sign-out, which runs its own cleanup and redirect.
export function markSigningOut() {
  signingOut = true
}

// An open tab outlives its session; send it to sign-in instead of letting
// every request fail with an error screen.
export function SessionExpiryRedirect() {
  useEffect(() => {
    const {
      data: { subscription },
    } = createBrowserClient().auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT" || signingOut) return
      const next = window.location.pathname + window.location.search
      window.location.assign(`/auth/signin?next=${encodeURIComponent(next)}`)
    })
    return () => subscription.unsubscribe()
  }, [])
  return null
}
