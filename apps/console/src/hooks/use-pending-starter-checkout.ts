"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  recoverStarterCheckout,
  type PendingStarterCheckout,
} from "@/lib/api/starter-checkout-recovery"

type State = {
  context: object
  phase: "checking" | "clear" | "pending" | "uncertain" | "error"
  purchase?: PendingStarterCheckout
  error: string | null
  busy: boolean
}

// Server discovery survives logout and a fresh browser. Local storage and return
// markers are navigation hints, never evidence that a checkout fence is clear.
export function usePendingStarterCheckout({
  team,
  actor,
  enabled,
  refresh,
}: {
  team: string | null
  actor: string | undefined
  enabled: boolean
  refresh: () => Promise<void>
}) {
  const context = useMemo(
    () => ({ team, actor, enabled }),
    [team, actor, enabled],
  )
  const current = useRef(context)
  current.current = context
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const running = useRef<object | null>(null)
  const unsettled = useRef<object | null>(null)
  const [saved, setSaved] = useState<State | null>(null)
  const active = enabled && !!team && !!actor
  const state = saved?.context === context ? saved : null

  const check = useCallback(async () => {
    if (
      !context.enabled ||
      !context.team ||
      !context.actor ||
      running.current === context
    )
      return
    running.current = context
    setSaved({ context, phase: "checking", busy: true, error: null })
    try {
      const result = await recoverStarterCheckout(context.team)
      if (current.current !== context) return
      if (result.outcome === "no_pending_starter_checkout") {
        if (unsettled.current === context) {
          await refreshRef.current()
          if (current.current !== context) return
          unsettled.current = null
        }
      } else unsettled.current = context
      setSaved({
        context,
        busy: false,
        error: null,
        phase:
          result.outcome === "no_pending_starter_checkout"
            ? "clear"
            : result.outcome === "pending_starter_checkout"
              ? "pending"
              : "uncertain",
        purchase:
          result.outcome === "pending_starter_checkout" ? result : undefined,
      })
    } catch {
      if (current.current === context)
        setSaved({
          context,
          phase: "error",
          busy: false,
          error:
            "Unable to check your existing purchase. Check its status before starting another payment.",
        })
    } finally {
      if (running.current === context) running.current = null
    }
  }, [context])

  useEffect(() => {
    current.current = context
    if (active) void check()
    return () => {
      if (current.current === context) current.current = { ...context }
    }
  }, [active, check, context])

  const act = async (cancel: boolean) => {
    const purchase = state?.purchase
    if (
      !active ||
      !purchase ||
      current.current !== context ||
      running.current === context
    )
      return
    running.current = context
    setSaved({ context, phase: "pending", purchase, busy: true, error: null })
    try {
      const result = await recoverStarterCheckout(
        context.team!,
        purchase,
        cancel,
      )
      if (current.current !== context) return
      if (result.outcome === "recovered" && !cancel) {
        window.location.assign(result.url)
        return
      }
      if (result.outcome === "retryable") {
        await refreshRef.current()
        if (current.current !== context) return
        unsettled.current = null
        running.current = null
        await check()
        return
      }
      // A lost cancellation acknowledgement or paid checkout stays fenced.
      // Ordinary status checks may converge it; never repeat cancellation here.
      setSaved({
        context,
        phase: "pending",
        purchase,
        busy: false,
        error:
          "Payment is not confirmed yet. Check purchase status before starting another payment.",
      })
    } catch {
      if (current.current === context)
        setSaved({
          context,
          phase: "pending",
          purchase,
          busy: false,
          error:
            "Unable to confirm the original purchase. Check purchase status again.",
        })
    } finally {
      if (running.current === context) running.current = null
    }
  }

  return {
    visible: enabled && (!team || !actor || state?.phase !== "clear"),
    blocksEntry: enabled && (!team || !actor || state?.phase !== "clear"),
    canStart: () =>
      !enabled ||
      (!!team &&
        !!actor &&
        current.current === context &&
        running.current !== context &&
        state?.phase === "clear"),
    purchase: state?.purchase,
    busy: !state || state.busy,
    error: state?.error ?? null,
    check: () => void check(),
    resume: () => void act(false),
    cancel: () => void act(true),
  }
}
