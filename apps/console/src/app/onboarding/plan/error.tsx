"use client"

import { Button } from "@superserve/ui"
import Link from "next/link"

export default function PlanError({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-dvh p-10">
      <h1 className="text-2xl">We couldn’t check your account setup</h1>
      <p role="alert" className="my-4">
        Please retry to confirm your latest account and payment status.
      </p>
      <Button onClick={reset}>Try again</Button>
      <Link className="ml-6 underline" href="/auth/signin">
        Sign in again
      </Link>
    </main>
  )
}
