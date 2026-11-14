"use client"

import { Button, Spinner } from "@superserve/ui"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { useSignOut } from "@/hooks/use-sign-out"
import { setActiveTeamAction } from "@/lib/api/teams-actions"
import {
  type CheckoutTeam,
  getCheckoutTeamAction,
} from "@/lib/billing/checkout-team-actions"
import {
  type CheckoutLocator,
  signupCheckoutReturnPath,
} from "@/lib/billing/signup-checkout-paths"

export function CheckoutElsewhere({ locator }: { locator: CheckoutLocator }) {
  const { account, team } = locator
  const returnPath = signupCheckoutReturnPath(account, team)
  const signInPath = `/auth/signin?next=${encodeURIComponent(returnPath)}`
  const signOut = useSignOut()
  const [attempt, setAttempt] = useState(0)
  const [read, setRead] = useState<{
    path: string
    result: CheckoutTeam | { kind: "error" }
  }>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const target = useRef({ live: false, busy: false })

  useEffect(() => {
    const current = { live: true, busy: false }
    target.current = current
    setRead(undefined)
    setBusy(false)
    setFailed(false)
    getCheckoutTeamAction({ account, team }).then(
      (result) => current.live && setRead({ path: returnPath, result }),
      () =>
        current.live &&
        setRead({ path: returnPath, result: { kind: "error" } }),
    )
    return () => {
      current.live = false
    }
  }, [account, team, returnPath, attempt])

  const result = read?.path === returnPath ? read.result : undefined
  if (!result)
    return (
      <div className="mt-5 h-5 w-5 animate-spin border-2 border-primary border-t-transparent" />
    )

  const switchTeam = async (team: { id: string; region: string }) => {
    const current = target.current
    if (current.busy) return
    current.busy = true
    setBusy(true)
    setFailed(false)
    try {
      await setActiveTeamAction(team.id, team.region)
      if (current.live) window.location.assign(returnPath)
    } catch {
      if (current.live) {
        current.busy = false
        setBusy(false)
        setFailed(true)
      }
    }
  }
  const switchAccount = async () => {
    const current = target.current
    if (current.busy) return
    current.busy = true
    setBusy(true)
    try {
      await signOut(returnPath)
    } catch {
      if (current.live) {
        current.busy = false
        setBusy(false)
      }
    }
  }

  const detail =
    result.kind === "switch"
      ? `This checkout is for ${result.team.name}, but a different team is open now. Switch to ${result.team.name} to continue.`
      : result.kind === "open"
        ? "The team that started this checkout is open now. Continue to check the payment."
        : result.kind === "other_account"
          ? "This checkout was started from a different account. Sign in with that account to continue."
          : result.kind === "signed_out"
            ? "Sign in to continue with this checkout."
            : result.kind === "not_member"
              ? "You're no longer a member of the team that started this checkout. Ask a team owner to invite you again, or continue in a team you belong to."
              : "We couldn't load your teams."

  return (
    <div className="flex w-full min-w-0 flex-col items-center">
      <p className="mt-2 text-center text-xs break-words text-muted">
        {detail}
      </p>
      <div className="mt-5 flex w-full flex-col items-center gap-2">
        {result.kind === "switch" && (
          <Button
            size="sm"
            className="max-w-full"
            disabled={busy}
            onClick={() => void switchTeam(result.team)}
          >
            {busy && <Spinner size="sm" />}
            <span className="max-w-full truncate">
              Switch to {result.team.name}
            </span>
          </Button>
        )}
        {result.kind === "open" && (
          <Button size="sm" render={<Link href={returnPath} />}>
            Continue
          </Button>
        )}
        {result.kind === "other_account" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void switchAccount()}
          >
            Sign out and switch account
          </Button>
        )}
        {result.kind === "signed_out" && (
          <Button size="sm" render={<Link href={signInPath} />}>
            Sign in
          </Button>
        )}
        {result.kind === "error" && (
          <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        )}
        <Button variant="outline" size="sm" render={<Link href="/sandboxes" />}>
          Back to console
        </Button>
      </div>
      {failed && (
        <p role="alert" className="mt-3 text-center text-xs text-destructive">
          We couldn&apos;t switch teams. Try again.
        </p>
      )}
    </div>
  )
}
