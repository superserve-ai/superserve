"use client"

import { type FormEvent, useEffect, useState } from "react"

// Opening Checkout takes seconds; a second submit meanwhile is refused by the
// backend and bounces the customer back, so only the first one goes out. A page
// restored from the back button starts fresh.
export function useSubmitOnce<T>() {
  const [submitting, setSubmitting] = useState<T | null>(null)
  useEffect(() => {
    const reset = (event: PageTransitionEvent) =>
      event.persisted && setSubmitting(null)
    window.addEventListener("pageshow", reset)
    return () => window.removeEventListener("pageshow", reset)
  }, [])
  const onSubmit = (value: T) => (event: FormEvent) => {
    if (submitting !== null) event.preventDefault()
    else setSubmitting(value)
  }
  return { submitting, onSubmit }
}
