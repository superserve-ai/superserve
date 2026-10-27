"use client"

import { useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { billingKeys } from "@/lib/api/query-keys"
import { genericBillingReturnState } from "@/lib/billing/checkout-return"

export function useBillingReturnNotice() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const pathname = usePathname()

  useEffect(() => {
    const url = new URL(window.location.href)
    const genericState = genericBillingReturnState(url.searchParams)
    if (url.searchParams.has("billing_flow") && genericState === null) return
    const inlineOwnsBilling =
      pathname === "/plan-usage" || pathname === "/plan-usage/"
    const proOwnsBilling =
      (pathname === "/billing/pro" || pathname === "/billing/pro/") &&
      (url.searchParams.has("team") ||
        (url.searchParams.has("billing") &&
          genericBillingReturnState(url.searchParams, "billing") === null))
    // A generic setup return must not consume another checkout's result.
    if (genericState === null && (inlineOwnsBilling || proOwnsBilling)) return
    const billingState = genericState ?? url.searchParams.get("billing")
    if (genericState !== null) {
      url.searchParams.delete("billing_flow")
      if (
        !inlineOwnsBilling &&
        !proOwnsBilling &&
        genericBillingReturnState(url.searchParams, "billing") !== null
      )
        url.searchParams.delete("billing")
    } else {
      if (genericBillingReturnState(url.searchParams, "billing") === null)
        return
      url.searchParams.delete("billing")
    }
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
