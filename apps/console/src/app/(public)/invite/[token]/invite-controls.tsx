"use client"

import { Button } from "@superserve/ui"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { INVITE_COPY } from "@/lib/invite/copy"

import {
  autoJoinInviteAction,
  joinInviteAction,
  signOutForInviteAction,
  type InviteActionResult,
} from "./actions"

function useJoin(token: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const router = useRouter()

  const join = async (
    action: (token: string) => Promise<InviteActionResult>,
  ) => {
    setBusy(true)
    setError(false)
    try {
      const result = await action(token)
      if (result.status === "redirect") {
        router.replace(result.to)
        return
      }
      if (result.code === "failed") {
        setError(true)
      } else {
        router.replace(`/invite/${token}/?failed=${result.code}`)
      }
    } catch {
      setError(true)
    }
    setBusy(false)
  }
  return { busy, error, join }
}

export function ConfirmControls({ token }: { token: string }) {
  const { busy, error, join } = useJoin(token)

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {INVITE_COPY.confirm.failed}
        </p>
      )}
      <Button
        className="w-full"
        onClick={() => void join(joinInviteAction)}
        disabled={busy}
      >
        {busy ? INVITE_COPY.confirm.joining : INVITE_COPY.confirm.join}
      </Button>
      <Button
        className="w-full"
        variant="outline"
        disabled={busy}
        render={<Link href="/sandboxes" />}
      >
        {INVITE_COPY.confirm.notNow}
      </Button>
    </div>
  )
}

// An account that started signup from this invite joins without a click. The
// server action re-checks the intent cookie and the team state itself.
export function AutoJoin({ token }: { token: string }) {
  const { busy, error, join } = useJoin(token)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void join(autoJoinInviteAction)
    // join is recreated each render; the ref makes this run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-3" aria-live="polite">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {INVITE_COPY.confirm.failed}
        </p>
      )}
      {error ? (
        <Button
          className="w-full"
          onClick={() => void join(joinInviteAction)}
          disabled={busy}
        >
          {INVITE_COPY.confirm.join}
        </Button>
      ) : (
        <p className="text-sm text-muted">{INVITE_COPY.confirm.joining}</p>
      )}
    </div>
  )
}

export function MismatchControls({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const router = useRouter()

  const signOut = async () => {
    setBusy(true)
    setError(false)
    try {
      const result = await signOutForInviteAction(token)
      if (result.status === "redirect") {
        router.replace(result.to)
        return
      }
      setError(true)
    } catch {
      setError(true)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {INVITE_COPY.mismatch.failed}
        </p>
      )}
      <Button className="w-full" onClick={signOut} disabled={busy}>
        {busy ? INVITE_COPY.mismatch.working : INVITE_COPY.mismatch.action}
      </Button>
    </div>
  )
}
