"use client"

import { useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { billingKeys } from "@/lib/api/query-keys"

export function useBillingReturnNotice() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const pathname = usePathname()

  useEffect(() => {
    // Preserve the billing page's inline return notice and cleanup.
    if (pathname === "/plan-usage" || pathname === "/plan-usage/") return
    const url = new URL(window.location.href)
    const billingState = url.searchParams.get("billing")
    if (!url.searchParams.has("billing")) return
    url.searchParams.delete("billing")
    window.history.replaceState(window.history.state, "", url.toString())
    void queryClient.invalidateQueries({ queryKey: billingKeys.all })
    if (billingState === "success") {
      addToast(
        "Returned from Stripe. Billing status is refreshing against the latest server state.",
        "info",
      )
    } else if (billingState === "cancel") {
      addToast(
        "Billing flow canceled. You can reopen billing setup any time.",
        "warning",
      )
    } else if (billingState === "portal-return") {
      addToast(
        "Billing portal closed. Billing status is refreshing against the latest server state.",
        "info",
      )
    }
  }, [pathname, queryClient, addToast])
}
