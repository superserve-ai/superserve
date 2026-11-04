"use client"

import { Button } from "@superserve/ui"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { INVITE_COPY } from "@/lib/invite/copy"

import { joinInviteAction, signOutForInviteAction } from "./actions"

export function ConfirmControls({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const router = useRouter()

  const join = async () => {
    setBusy(true)
    setError(false)
    try {
      const result = await joinInviteAction(token)
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

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {INVITE_COPY.confirm.failed}
        </p>
      )}
      <Button className="w-full" onClick={join} disabled={busy}>
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
