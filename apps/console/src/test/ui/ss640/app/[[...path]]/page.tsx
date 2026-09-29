"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"

import AuthCodeErrorPage from "../../../../../app/(auth)/auth/auth-code-error/page"
import SignUpContent from "../../../../../app/(auth)/auth/signup/form"
import {
  productionSignupCases,
  syntheticSignupValues,
  SyntheticBrowserDependencies,
} from "../../browser-dependencies"
import { scenarios } from "../../scenarios"

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
  if (scenario.state === "loading") {
    return <div className="h-8 w-48 bg-surface-hover" aria-label="Loading" />
  }
  if (scenario.state === "uncertain") {
    return (
      <main className="flex min-h-screen flex-col gap-4 p-12">
        <p>Something went wrong</p>
        <button type="button">Try Again</button>
      </main>
    )
  }
  return <main className="flex min-h-screen p-12">No Sandboxes</main>
}

function West({ scenario }: { scenario: (typeof scenarios)[string] }) {
  if (scenario.state === "loading") {
    return (
      <main className="flex min-h-screen flex-col gap-4 p-12">
        <button disabled type="button">
          Creating...
        </button>
        <span aria-label="Team region">US West</span>
      </main>
    )
  }
  if (scenario.state === "uncertain") {
    return (
      <main className="flex min-h-screen flex-col gap-4 p-12">
        <button type="button">Create Team</button>
        <span aria-label="Team region">US West</span>
        <div className="pointer-events-auto">
          <svg className="text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">Something went wrong</p>
        </div>
      </main>
    )
  }
  return (
    <main className="flex min-h-screen flex-col gap-4 p-12">
      <div>Team West fixture team created in US West</div>
      <div className="border-dashed">
        <div>
          <span className="text-sm">West fixture team</span>
        </div>
      </div>
      <span aria-label="Active team">West fixture team · US West</span>
      <input placeholder="my-team" />
    </main>
  )
}

function Login({ scenario }: { scenario: (typeof scenarios)[string] }) {
  if (scenario.kind === "dashboard") return <Dashboard scenario={scenario} />
  return (
    <main className="flex min-h-screen flex-col gap-4 p-12">
      <h2>Teams</h2>
      <input placeholder="my-team" />
    </main>
  )
}

function FixturePage() {
  const pathname = usePathname()
  const params = useSearchParams()
  const caseId = params.get("ui_case") ?? "ss640-email-idle"
  const scenario = scenarios[caseId] ?? scenarios["ss640-email-idle"]

  if (pathname.startsWith("/auth/auth-code-error")) return <AuthCodeErrorPage />
  if (pathname.startsWith("/auth/signup")) {
    if (
      productionSignupCases.has(caseId) ||
      params.get("complete_google") === "1"
    ) {
      return (
        <SyntheticBrowserDependencies>
          <SignUpContent
            initialValues={syntheticSignupValues}
            confirmationRecipient="Synthetic account"
          />
        </SyntheticBrowserDependencies>
      )
    }
    if (params.get("complete_google") === "1")
      return <Dashboard scenario={scenario} />
    if (scenario.kind === "dashboard") return <Dashboard scenario={scenario} />
    return <SignUp scenario={scenario} />
  }
  if (pathname.startsWith("/sandboxes"))
    return <Dashboard scenario={scenario} />
  if (pathname.startsWith("/settings")) return <West scenario={scenario} />
  if (pathname.startsWith("/auth/signin")) return <Login scenario={scenario} />
  return <Dashboard scenario={scenario} />
}

export default function Page() {
  return (
    <Suspense fallback={<div className="h-8 w-48 bg-surface-hover" />}>
      <FixturePage />
    </Suspense>
  )
}
