import { Suspense } from "react"

import { readPlanCatalog } from "@/lib/api/plan-catalog-read"

import SignUpContent from "./form"

export default async function SignUpPage() {
  const catalog = await readPlanCatalog()
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <SignUpContent catalog={catalog} />
    </Suspense>
  )
}
