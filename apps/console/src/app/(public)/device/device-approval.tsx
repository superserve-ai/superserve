"use client"

import { Button } from "@superserve/ui"
import { useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"

import { Spinner } from "@/components/icons"
import { commitFreePlan } from "@/lib/api/plan-checkout"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"

import { approveDeviceAction, denyDeviceAction } from "./actions"

type Outcome = "approved" | "denied" | null

export function DeviceApproval({
  userCode,
  clientName,
  email,
  teamKey,
}: {
  userCode: string
  clientName: string
  email: string
  /** The team the key will go to; approval fails if it changes meanwhile. */
  teamKey: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const router = useRouter()
  const posthog = usePostHog()

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      let result = await approveDeviceAction(userCode, teamKey)
      if (result.status === "commit_free_plan") {
        await commitFreePlan(result.teamKey)
        result = await approveDeviceAction(userCode, teamKey)
      }
      if (result.status === "redirect") {
        router.replace(result.to)
        return
      }
      if (result.status === "approved") {
        setOutcome("approved")
        posthog?.capture(AUTH_EVENTS.DEVICE_AUTHORIZED, { user_email: email })
        return
      }
      setError(result.status === "error" ? result.message : "Please try again.")
    } catch {
      setError("Couldn't authorize the CLI. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  // Signs out this browser only and comes back to the same code.
  const switchAccount = async () => {
    setBusy(true)
    setError(null)
    const { error: signOutError } = await createBrowserClient()
      .auth.signOut({ scope: "local" })
      .catch((cause: unknown) => ({ error: cause }))
    if (signOutError) {
      setError("Couldn't sign out. Please try again.")
      setBusy(false)
      return
    }
    posthog?.reset()
    router.replace(
      `/auth/signin?next=${encodeURIComponent(`/device?code=${userCode}`)}`,
    )
  }

  const deny = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await denyDeviceAction(userCode)
      if (result.status === "denied") setOutcome("denied")
      else setError(result.message)
    } catch {
      setError("Couldn't deny the login. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (outcome) {
    return (
      <>
        <h1 className="mb-2 text-xl font-semibold text-foreground">
          {outcome === "approved" ? "CLI authorized" : "Login denied"}
        </h1>
        <p className="text-sm text-muted">
          {outcome === "approved"
            ? "You can close this tab and go back to your terminal."
            : "The CLI was not given access. You can close this tab."}
        </p>
      </>
    )
  }

  return (
    <>
      <h1 className="mb-2 text-xl font-semibold text-foreground">
        Authorize Superserve CLI
      </h1>
      <p className="mb-6 text-sm text-muted">
        Signed in as{" "}
        <span className="font-medium text-foreground">{email}</span>.{" "}
        <button
          type="button"
          onClick={switchAccount}
          disabled={busy}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Use a different account
        </button>
      </p>
      <p className="mb-2 text-xs text-muted">
        <span className="font-medium text-foreground">{clientName}</span> wants
        an API key. Only authorize if you started this login and the code
        matches your terminal:
      </p>
      <code className="mb-6 flex justify-center bg-background px-3 py-2 font-mono text-2xl font-medium tracking-wide text-primary">
        {userCode}
      </code>
      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          onClick={approve}
          disabled={busy}
          className="w-full"
        >
          {busy ? <Spinner /> : null}
          Authorize
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={deny}
          disabled={busy}
          className="w-full"
        >
          Deny
        </Button>
      </div>
    </>
  )
}
