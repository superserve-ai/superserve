"use client"

import {
  type FormEvent,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"

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

// Like useSubmitOnce, but every component that calls the returned hook shares
// one pending submit, so a page that shows the same checkout form twice still
// sends only one.
export function createSharedSubmitOnce() {
  let submitting = false
  const listeners = new Set<() => void>()
  const setSubmitting = (value: boolean) => {
    submitting = value
    listeners.forEach((listener) => listener())
  }
  const reset = (event: PageTransitionEvent) => {
    if (event.persisted) setSubmitting(false)
  }
  const subscribe = (listener: () => void) => {
    if (listeners.size === 0) window.addEventListener("pageshow", reset)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        window.removeEventListener("pageshow", reset)
        submitting = false
      }
    }
  }
  const getSnapshot = () => submitting
  const getServerSnapshot = () => false
  const onSubmit = (event: FormEvent) => {
    if (submitting) event.preventDefault()
    else setSubmitting(true)
  }

  return function useSharedSubmitOnce() {
    const submitting = useSyncExternalStore(
      subscribe,
      getSnapshot,
      getServerSnapshot,
    )
    return { submitting, onSubmit }
  }
}
