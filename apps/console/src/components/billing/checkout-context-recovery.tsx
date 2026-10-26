"use client"

import { Button } from "@superserve/ui"
import { useIsMutating, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { retainSignOutReturnPath } from "@/components/layout/session-expiry-redirect"
import { useSwitchTeam, useTeams } from "@/hooks/use-teams"
import { useUser } from "@/hooks/use-user"
import {
  checkoutEntryPath,
  checkoutRecoveryPath,
  checkoutTeamReference,
} from "@/lib/billing/checkout-return"
import { createBrowserClient } from "@/lib/supabase/client"

export function CheckoutContextRecovery({
  callbackPath,
  allowSwitch = true,
  contextPending = false,
}: {
  callbackPath: string
  allowSwitch?: boolean
  contextPending?: boolean
}) {
  const queryClient = useQueryClient()
  const switchingTeam = useIsMutating({ mutationKey: ["switch-team"] }) > 0
  const directory = useTeams()
  const switchTeam = useSwitchTeam()
  const actor = useUser().user?.id
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = useRef({ active: true, busy: false })
  const signOutIntent = useRef<{
    actor: string | undefined
    active: boolean
    release: () => void
  } | null>(null)
  useEffect(() => {
    setSigningOut(false)
    return () => {
      if (signOutIntent.current) {
        signOutIntent.current.active = false
        signOutIntent.current.release()
        signOutIntent.current = null
      }
    }
  }, [callbackPath])
  useEffect(() => {
    const intent = signOutIntent.current
    if (!intent || !actor) return
    if (!intent.actor) intent.actor = actor
    else if (actor !== intent.actor) {
      intent.active = false
      intent.release()
      signOutIntent.current = null
      setSigningOut(false)
    }
  }, [actor])
  useEffect(() => {
    const current = { active: true, busy: false }
    target.current = current
    setBusy(false)
    setError(null)
    return () => {
      current.active = false
    }
  }, [actor, callbackPath])
  const entryPath = checkoutEntryPath(callbackPath)
  const safePath = checkoutRecoveryPath(callbackPath) ?? entryPath
  const team = safePath
    ? checkoutTeamReference(
        new URL(safePath, "https://console.invalid").searchParams.get("team"),
      )
    : null
  const member =
    team &&
    directory.data?.teams.some(
      (item) => item.id === team.teamId && item.region === team.region,
    )
  const recover = async (work: () => Promise<void>) => {
    const current = target.current
    if (
      current.busy ||
      signOutIntent.current?.active ||
      queryClient.isMutating({ mutationKey: ["switch-team"] }) > 0
    )
      return
    current.busy = true
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch {
      if (current.active)
        setError("Unable to restore checkout. Please try again.")
    } finally {
      current.busy = false
      if (current.active) setBusy(false)
    }
  }
  return (
    <div className="space-y-3 p-3">
      {contextPending ? (
        <p className="text-sm text-muted">Loading checkout account…</p>
      ) : (
        <p role="alert" className="text-sm text-muted">
          {entryPath
            ? "Return to the account and team that started signup to continue choosing your plan. No purchase will be started automatically."
            : "Return to the account and team that started checkout to check its payment status. This will not start another purchase."}
        </p>
      )}
      {safePath ? (
        <>
          {allowSwitch && member && !contextPending && (
            <Button
              disabled={busy || signingOut || switchingTeam}
              onClick={() =>
                void recover(async () => {
                  if (!team) return
                  await switchTeam.mutateAsync(team)
                })
              }
            >
              {entryPath ? "Return to signup team" : "Return to checkout team"}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || signingOut || switchingTeam}
            onClick={() =>
              void recover(async () => {
                const intent = {
                  actor,
                  active: true,
                  release: retainSignOutReturnPath(safePath),
                }
                signOutIntent.current = intent
                setSigningOut(true)
                try {
                  const { error } = await createBrowserClient().auth.signOut({
                    scope: "local",
                  })
                  if (error) throw error
                  if (intent.active)
                    window.location.assign(
                      `/auth/signin?next=${encodeURIComponent(safePath)}`,
                    )
                } catch (cause) {
                  intent.active = false
                  intent.release()
                  setSigningOut(false)
                  if (signOutIntent.current === intent)
                    signOutIntent.current = null
                  throw cause
                }
              })
            }
          >
            {entryPath
              ? "Sign out and use signup account"
              : "Sign out and use checkout account"}
          </Button>
          {(directory.isError || contextPending) && (
            <Button
              variant="outline"
              disabled={busy || signingOut || switchingTeam}
              onClick={() => {
                if (
                  !busy &&
                  queryClient.isMutating({ mutationKey: ["switch-team"] }) === 0
                )
                  void directory.refetch()
              }}
            >
              Retry team lookup
            </Button>
          )}
        </>
      ) : (
        <p role="alert" className="text-sm text-muted">
          This checkout return link is incomplete or invalid. Open Billing for
          the team that started checkout.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
