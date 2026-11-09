"use client"

import { Suspense } from "react"

import { Spinner } from "@/components/icons"

import SignUpContent from "./form"

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner className="border-primary" />
        </div>
      }
    >
      <SignUpContent />
    </Suspense>
  )
}
