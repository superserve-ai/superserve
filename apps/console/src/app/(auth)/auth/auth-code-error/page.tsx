"use client"

import { WarningIcon } from "@phosphor-icons/react"
import { Button, cn } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useState, useSyncExternalStore } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import { inviteReturnPath } from "@/lib/auth/invite-return-path"
import { SIGNUP_RESTRICTED_MESSAGE } from "@/lib/auth/signup-restricted-message"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
  signupPreparationReturnPath,
} from "@/lib/billing/pro-auth-return"
import { inviteLinkReplayClass } from "@/lib/invite-token-redaction"
import { createBrowserClient } from "@/lib/supabase/client"

function subscribeToHashChange(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

function getHash() {
  return window.location.hash
}

function getServerHash() {
  return ""
}

function AuthCodeErrorContent() {
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState(false)
  const searchParams = useSearchParams()
  const hash = useSyncExternalStore(
    subscribeToHashChange,
    getHash,
    getServerHash,
  )
  const isSignupContext = searchParams.get("reason") === "signup_blocked"
  const retryParams = new URLSearchParams()
  // Carry only the recognized retry preference; it cannot authorize admission.
  if (searchParams.get("signup_offer") === "enterprise")
    retryParams.set("signup_offer", "enterprise")
  const invite = inviteReturnPath(searchParams.get("next"))
  if (invite) retryParams.set("next", invite)
  const continuation =
    proAuthReturnPath(searchParams.get("next")) ??
    starterAuthReturnPath(searchParams.get("next"))
  const account = searchParams.get("account")
  const setupReason = searchParams.get("reason")
  const linkExpired =
    setupReason === null &&
    (searchParams.get("error_code") === "otp_expired" ||
      new URLSearchParams(hash.slice(1)).get("error_code") === "otp_expired")
  const recoveryLinkExpired =
    linkExpired && searchParams.get("type") === "recovery"
  const expiredMessage = recoveryLinkExpired
    ? "This password reset link expired or was already used. Request a new link to reset your password."
    : "This link expired or was already used. To reset your password, request a new reset link. To confirm a new account, sign up again with the same email and password to get a new confirmation link."
  const confirmationHref = `/auth/signup?error=link_expired${retryParams.size ? `&${retryParams}` : ""}`
  const setupRetry =
    [
      "account_setup",
      "account_changed",
      "impersonation",
      "team_changed",
      "team_conflict",
    ].includes(setupReason ?? "") &&
    continuation &&
    account
      ? signupPreparationReturnPath(
          `/api/onboarding/prepare/?${new URLSearchParams({ account, next: continuation })}`,
        )
      : null
  const wrongAccount = setupReason === "account_changed" && !!setupRetry
  const impersonating = setupReason === "impersonation" && !!setupRetry
  const wrongTeam = setupReason === "team_changed" && !!setupRetry
  const conflictingTeams = setupReason === "team_conflict" && !!setupRetry
  const retryHref =
    setupRetry ??
    `${isSignupContext ? "/auth/signup" : "/auth/signin"}${retryParams.size ? `?${retryParams}` : ""}`

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <DitherBackground />
      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />

        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image
              src="/logo.svg"
              alt="Superserve"
              width={120}
              height={24}
              className="h-6 w-auto"
            />
          </Link>
        </div>

        <div className="flex flex-col items-center">
          <WarningIcon className="mb-3 size-8 text-muted" weight="light" />
          <h1 className="text-center text-sm font-medium text-foreground">
            {linkExpired
              ? recoveryLinkExpired
                ? "Reset link expired"
                : "Link expired"
              : "Authentication Error"}
          </h1>
          <p className="mt-2 text-center text-xs text-muted">
            {wrongAccount
              ? "Sign in to the account that started checkout to continue with your selected plan."
              : impersonating
                ? "End impersonation from the console before continuing with your selected plan."
                : wrongTeam
                  ? "Return to the team that started checkout before continuing with your selected plan."
                  : conflictingTeams
                    ? "Saved checkout team details conflict. Return to the original checkout link, or contact support if it is unavailable."
                    : isSignupContext
                      ? SIGNUP_RESTRICTED_MESSAGE
                      : linkExpired
                        ? expiredMessage
                        : "Something went wrong. Please try again."}
          </p>
          {linkExpired ? (
            <>
              <Button
                render={<Link href="/auth/forgot-password" />}
                size="sm"
                className="mt-5"
              >
                Request a new reset link
              </Button>
              {!recoveryLinkExpired && (
                <Link
                  href={confirmationHref}
                  className={cn(
                    "mt-5 underline",
                    inviteLinkReplayClass(confirmationHref),
                  )}
                >
                  Get a new confirmation link
                </Link>
              )}
              <Link
                href={retryHref}
                className={cn(
                  "mt-5 underline",
                  inviteLinkReplayClass(retryHref),
                )}
              >
                Back to sign in
              </Link>
            </>
          ) : wrongAccount ? (
            <Button
              size="sm"
              className="mt-5"
              disabled={switching}
              onClick={async () => {
                setSwitching(true)
                setSwitchError(false)
                try {
                  const { error } = await createBrowserClient().auth.signOut({
                    scope: "local",
                  })
                  if (error) throw error
                  window.location.assign(
                    `/auth/signin?next=${encodeURIComponent(setupRetry!)}`,
                  )
                } catch {
                  setSwitchError(true)
                  setSwitching(false)
                }
              }}
            >
              {switching ? "Signing out…" : "Sign out and use another account"}
            </Button>
          ) : (
            <>
              {impersonating && (
                <Link href="/sandboxes" className="mt-5 underline">
                  Return to console to end impersonation
                </Link>
              )}
              {wrongTeam && (
                <Link href="/sandboxes" className="mt-5 underline">
                  Return to console to select the original team
                </Link>
              )}
              {conflictingTeams && (
                <Link href="/sandboxes" className="mt-5 underline">
                  Return to console
                </Link>
              )}
              {!conflictingTeams && (
                <Button
                  render={<Link href={retryHref} />}
                  size="sm"
                  className={cn("mt-5", inviteLinkReplayClass(retryHref))}
                >
                  {impersonating
                    ? "Continue after ending impersonation"
                    : wrongTeam
                      ? "Continue after selecting the original team"
                      : "Try Again"}
                </Button>
              )}
            </>
          )}
          {switchError && (
            <p role="alert" className="mt-2 text-xs">
              Unable to sign out. Please try again.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AuthCodeErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <AuthCodeErrorContent />
    </Suspense>
  )
}
