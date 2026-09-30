"use client"

import { ToastProvider } from "@superserve/ui"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import AuthCodeErrorPage from "../../../../../app/(auth)/auth/auth-code-error/page"
import SignInPage from "../../../../../app/(auth)/auth/signin/page"
import SignUpContent from "../../../../../app/(auth)/auth/signup/form"
import { QueryProvider } from "../../../../../components/query-provider"
import { TableSkeleton } from "../../../../../components/table-skeleton"
import { TrialBillingBanner } from "../../../../../components/trial-billing-banner"
import {
  productionSignupCases,
  SyntheticBrowserDependencies,
} from "../../browser-dependencies"
import { scenarios } from "../../scenarios"
import { West } from "../../west"

function SignUp({ scenario }: { scenario: (typeof scenarios)[string] }) {
  if (scenario.state === "success") {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-12">
        <h1>Check Your Email</h1>
        <p>We sent a confirmation link to your fixture address.</p>
        <Link href="/auth/signin">Sign in</Link>
      </main>
    )
  }

  const error = scenario.message
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-12">
      <h1>Create your Superserve account</h1>
      {error && <p className="text-destructive">{error}</p>}
      <form onSubmit={(event) => event.preventDefault()}>
        <label>
          Full name
          <input aria-label="Full name" />
        </label>
        <label>
          Email
          <input aria-label="Email" type="email" />
        </label>
        <label>
          Password
          <input aria-label="Password" type="text" autoComplete="off" />
        </label>
        <button disabled={scenario.state === "loading"} type="submit">
          {scenario.state === "loading"
            ? "Creating account..."
            : "Create account"}
        </button>
      </form>
      <button disabled={scenario.state === "loading"} type="button">
        {scenario.state === "loading"
          ? "Signing up..."
          : "Continue with Google"}
      </button>
    </main>
  )
}

function Dashboard({ scenario }: { scenario: (typeof scenarios)[string] }) {
  const [recoveryClicks, setRecoveryClicks] = useState(0)
  const recoveryComplete = recoveryClicks >= (scenario.recoveryClicks ?? 1)
  const params = useSearchParams()
  const caseId =
    params.get("ui_case") ??
    (typeof window !== "undefined"
      ? sessionStorage.getItem("ss640-ui-case")
      : null)

  if (scenario.state === "loading") {
    return (
      <main aria-label="Loading" className="min-h-screen">
        <TableSkeleton columns={6} rows={5} tabs={3} />
      </main>
    )
  }
  if (scenario.state === "uncertain" && !recoveryComplete) {
    return (
      <main className="flex min-h-screen flex-col gap-4 p-12">
        <p>Something went wrong</p>
        <button
          type="button"
          onClick={() => setRecoveryClicks((count) => count + 1)}
        >
          Try Again
        </button>
      </main>
    )
  }
  return (
    <main className="flex min-h-screen flex-col gap-4 p-12">
      <span>No Sandboxes</span>
      {caseId === "ss640-existing-email-login" && (
        <Link href="/settings">Settings</Link>
      )}
    </main>
  )
}

function Login() {
  return (
    <SyntheticBrowserDependencies>
      <SignInPage />
    </SyntheticBrowserDependencies>
  )
}

function BillingFixture() {
  useEffect(() => {
    const requestedCase = new URLSearchParams(window.location.search).get(
      "ui_case",
    )
    if (requestedCase) {
      document.cookie = `ss640-ui-case=${encodeURIComponent(requestedCase)}; Path=/; SameSite=Lax`
      sessionStorage.setItem("ss640-ui-case", requestedCase)
    }
  }, [])

  return (
    <QueryProvider>
      <ToastProvider>
        <div className="flex min-h-screen flex-col">
          <TrialBillingBanner />
          <main className="flex min-h-screen flex-col gap-4 p-12">
            <span>No Sandboxes</span>
          </main>
        </div>
      </ToastProvider>
    </QueryProvider>
  )
}

function FixturePage() {
  const pathname = usePathname()
  const params = useSearchParams()
  // The browser procedure enters every case with a query string. During the
  // first client render Next can briefly expose an empty search-param object
  // while the App Router hydrates; reading the URL as the same-render fallback
  // keeps the approved production fixture mounted instead of falling back to
  // the inert scenario screen.
  const caseId =
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ui_case")
      : null) ??
    params.get("ui_case") ??
    (typeof window !== "undefined"
      ? sessionStorage.getItem("ss640-ui-case")
      : null) ??
    "ss640-email-idle"
  const scenario = scenarios[caseId] ?? scenarios["ss640-email-idle"]

  if (pathname.startsWith("/auth/auth-code-error")) return <AuthCodeErrorPage />
  if (pathname.startsWith("/auth/signup")) {
    if (
      productionSignupCases.has(caseId) ||
      params.get("complete_google") === "1"
    ) {
      return (
        <SyntheticBrowserDependencies>
          <SignUpContent />
        </SyntheticBrowserDependencies>
      )
    }
    if (params.get("complete_google") === "1")
      return <Dashboard scenario={scenario} />
    if (scenario.kind === "dashboard") return <Dashboard scenario={scenario} />
    return <SignUp scenario={scenario} />
  }
  if (pathname.startsWith("/sandboxes")) {
    if (caseId.startsWith("ss640-billing-")) return <BillingFixture />
    return <Dashboard scenario={scenario} />
  }
  if (pathname.startsWith("/settings")) return <West />
  if (pathname.startsWith("/auth/signin")) return <Login />
  return <Dashboard scenario={scenario} />
}

export default function Page() {
  // Session-backed scenarios are available only after hydration. Keep the
  // server and first browser render identical across full auth redirects.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return (
    <Suspense
      fallback={
        <main aria-label="Loading" className="min-h-screen">
          <TableSkeleton columns={6} rows={5} tabs={3} />
        </main>
      }
    >
      <FixturePage />
    </Suspense>
  )
}
