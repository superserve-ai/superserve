"use client"

import { Button } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import {
  PaymentProcessing,
  SETTLE_POLL_MS,
  SETTLE_TIMEOUT_MS,
} from "@/components/billing/payment-processing"
import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import { isStripeCheckoutUrl } from "@/lib/api/plan-checkout"
import { checkoutLocator } from "@/lib/billing/signup-checkout-paths"

import { checkSignupPaymentAction } from "./actions"

export function PaymentWait() {
  const router = useRouter()
  const locator = checkoutLocator(useSearchParams())
  const account = locator?.account
  const team = locator?.team
  const [round, setRound] = useState(0)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!account || !team) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = Date.now() + SETTLE_TIMEOUT_MS
    const poll = async () => {
      const next = await checkSignupPaymentAction(account, team).catch(
        () => null,
      )
      if (stopped) return
      if (next) {
        if (isStripeCheckoutUrl(next)) window.location.assign(next)
        else router.replace(next)
        return
      }
      if (Date.now() >= deadline) setTimedOut(true)
      else timer = setTimeout(poll, SETTLE_POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [account, team, round, router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <DitherBackground />
      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />
        <div className="mb-8 flex justify-center">
          <Image
            src="/logo.svg"
            alt="Superserve"
            width={120}
            height={24}
            className="h-6 w-auto"
          />
        </div>
        <div className="flex flex-col items-center text-center">
          {account && team ? (
            <PaymentProcessing
              waiting={!timedOut}
              onRetry={() => {
                setTimedOut(false)
                setRound((value) => value + 1)
              }}
            />
          ) : (
            <Button render={<Link href="/sandboxes" />} size="sm">
              Back to console
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
