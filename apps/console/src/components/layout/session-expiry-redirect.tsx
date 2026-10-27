"use client"

import { useEffect } from "react"

import {
  checkoutEntryPath,
  checkoutRecoveryPath,
} from "@/lib/billing/checkout-return"
import { createBrowserClient } from "@/lib/supabase/client"

let signingOut = false
const signOutReturns = new Map<symbol, string>()

// Register before signOut: its auth event can precede the promise result.
export function retainSignOutReturnPath(path: string): () => void {
  const safe = checkoutRecoveryPath(path) ?? checkoutEntryPath(path)
  if (!safe) throw new Error("Invalid billing recovery destination")
  const token = Symbol()
  signOutReturns.set(token, safe)
  return () => {
    signOutReturns.delete(token)
  }
}

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
      const retained = Array.from(signOutReturns.values()).at(-1)
      signOutReturns.clear()
      const next = retained ?? window.location.pathname + window.location.search
      window.location.assign(`/auth/signin?next=${encodeURIComponent(next)}`)
    })
    return () => subscription.unsubscribe()
  }, [])
  return null
}
