"use client"

import { useToast } from "@superserve/ui"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { useQueryScope } from "@/components/query-provider"
import type { BillingSummaryResponse } from "@/lib/api/billing"
import {
  createStripeCheckoutSession,
  createStripeCustomerPortalSession,
} from "@/lib/api/billing-stripe"
import { teamKeys } from "@/lib/api/query-keys"
import type { TeamDirectoryResponse } from "@/lib/api/teams-actions"

// The shell and billing page can both offer payment setup. Share the in-flight guard.
const paymentRequests = new WeakSet<QueryClient>()

export function useBillingPayment(
  summary: BillingSummaryResponse | null | undefined,
  teamKey: string | null,
) {
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const cacheScope = useQueryScope()
  const [submitting, setSubmitting] = useState<"checkout" | "portal" | null>(
    null,
  )
  const pending = useRef(false)
  const mounted = useRef(true)
  const identity = `${cacheScope}:${teamKey}`
  const currentIdentity = useRef(identity)
  useLayoutEffect(() => {
    currentIdentity.current = identity
  }, [identity])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const available = Boolean(
    summary?.permissions?.can_manage &&
    (summary.portal_available || summary.checkout_available) &&
    cacheScope === "self",
  )

  const openSession = async () => {
    if (
      pending.current ||
      paymentRequests.has(queryClient) ||
      !available ||
      !teamKey ||
      queryClient.isMutating({ mutationKey: ["switch-team"] })
    )
      return
    const directory = queryClient.getQueryData<TeamDirectoryResponse>(
      teamKeys.directory(),
    )
    if (
      directory &&
      `${directory.activeRegion}:${directory.activeTeamId}` !== teamKey
    )
      return
    pending.current = true
    paymentRequests.add(queryClient)
    const canApply = () => {
      const latest = queryClient.getQueryData<TeamDirectoryResponse>(
        teamKeys.directory(),
      )
      return (
        mounted.current &&
        currentIdentity.current === identity &&
        !queryClient.isMutating({ mutationKey: ["switch-team"] }) &&
        (!latest || `${latest.activeRegion}:${latest.activeTeamId}` === teamKey)
      )
    }
    setSubmitting(summary?.portal_available ? "portal" : "checkout")
    const currentUrl = new URL(window.location.href)
    try {
      let session
      if (summary?.portal_available) {
        const returnUrl = new URL(currentUrl)
        returnUrl.searchParams.set("billing", "portal-return")
        session = await createStripeCustomerPortalSession({
          returnUrl: returnUrl.toString(),
        })
      } else {
        const successUrl = new URL(currentUrl)
        successUrl.searchParams.set("billing", "success")
        const cancelUrl = new URL(currentUrl)
        cancelUrl.searchParams.set("billing", "cancel")
        session = await createStripeCheckoutSession({
          successUrl: successUrl.toString(),
          cancelUrl: cancelUrl.toString(),
        })
      }
      if (canApply()) window.location.assign(session.url)
    } catch (error) {
      if (canApply())
        addToast(
          error instanceof Error ? error.message : "Failed to open Stripe",
          "error",
        )
    } finally {
      pending.current = false
      paymentRequests.delete(queryClient)
      if (mounted.current) setSubmitting(null)
    }
  }
  return { submitting, available, openSession }
}
