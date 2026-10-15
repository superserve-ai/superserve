"use client"

import { Button } from "@superserve/ui"
import { useEffect, useState } from "react"

import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { setActiveTeamAction } from "@/lib/api/teams-actions"
import { createBrowserClient } from "@/lib/supabase/client"

import { PlanSelection } from "./plan-selection"

export function PlanSelectionLoader({
  billingReturn,
  expectedTeam,
  expectedUser,
}: {
  billingReturn?: string
  expectedTeam?: string
  expectedUser?: string
}) {
  const [initial, setInitial] = useState<SignupPlanContext | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const returnPath = `/onboarding/plan/?${new URLSearchParams({ ...(expectedTeam ? { team: expectedTeam } : {}), ...(expectedUser ? { account: expectedUser } : {}), ...(billingReturn ? { billing: billingReturn } : {}) })}`
  useEffect(() => {
    let active = true
    setFailed(false)
    setInitial(null)
    // Invoke as a server action: first signup provisioning can consume proof cookies.
    void getSignupPlanAction(expectedTeam, expectedUser, billingReturn)
      .then((value) => {
        if (active) setInitial(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [expectedTeam, expectedUser, billingReturn, attempt])
  if (failed)
    return (
      <main className="min-h-dvh p-10">
        <h1 className="text-2xl">We couldn’t confirm your account setup</h1>
        <p role="alert" className="my-4">
          {expectedTeam
            ? "Return to the account and team that started checkout before continuing. We’ll check its payment status before offering another plan."
            : "Please retry to confirm your latest account and payment status."}
        </p>
        <Button onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </Button>
        {expectedTeam && (
          <Button
            className="ml-3"
            variant="outline"
            onClick={async () => {
              const [region, teamId] = expectedTeam.split(":")
              if (!region || !teamId) return
              try {
                await setActiveTeamAction(teamId, region)
                setAttempt((value) => value + 1)
              } catch {
                setFailed(true)
              }
            }}
          >
            Return to checkout team
          </Button>
        )}
        <Button
          className="ml-3"
          variant="outline"
          disabled={switchingAccount}
          onClick={async () => {
            setSwitchingAccount(true)
            setRecoveryError(null)
            try {
              const { error } = await createBrowserClient().auth.signOut({
                scope: "local",
              })
              if (error) throw error
              window.location.assign(
                `/auth/signin?next=${encodeURIComponent(returnPath)}`,
              )
            } catch {
              setRecoveryError("Unable to sign out. Please try again.")
              setSwitchingAccount(false)
            }
          }}
        >
          Sign out and use another account
        </Button>
        {recoveryError && (
          <p role="alert" className="mt-4">
            {recoveryError}
          </p>
        )}
      </main>
    )
  if (!initial)
    return (
      <main className="p-10">
        <output>Checking your account setup…</output>
      </main>
    )
  return (
    <PlanSelection
      key={`${initial.userId}:${initial.teamKey}`}
      initial={initial}
      billingReturn={billingReturn}
    />
  )
}
