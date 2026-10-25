"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import Script from "next/script"
import { useCallback, useEffect, useRef, useState } from "react"

import type { EnterpriseMeeting } from "@/lib/auth/enterprise-meeting"
import { createBrowserClient } from "@/lib/supabase/client"

// superserve.ai/meet points here.
const CALENDLY_URL = "https://calendly.com/superserve-ai/25-min"
const CALENDLY_WIDGET_SRC =
  "https://assets.calendly.com/assets/external/widget.js"
const CALENDLY_LOAD_TIMEOUT_MS = 10_000

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (options: {
        url: string
        parentElement: HTMLElement
      }) => void
    }
  }
}

export function calendlyBookingUrl(name?: string, email?: string): string {
  const url = new URL(CALENDLY_URL)
  url.searchParams.set("hide_gdpr_banner", "1")
  if (name) url.searchParams.set("name", name)
  if (email) url.searchParams.set("email", email)
  return url.toString()
}

function CalendlyEmbed({
  url,
  onScheduled,
}: {
  url: string
  onScheduled: () => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  )

  useEffect(() => {
    if (status !== "loading") return
    const timer = window.setTimeout(
      () => setStatus("failed"),
      CALENDLY_LOAD_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [status])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const frame = container.current?.querySelector("iframe")
      if (
        event.origin === "https://calendly.com" &&
        frame?.contentWindow &&
        event.source === frame.contentWindow &&
        event.data?.event === "calendly.event_scheduled"
      )
        onScheduled()
    }
    window.addEventListener("message", receive)
    return () => window.removeEventListener("message", receive)
  }, [onScheduled])

  const init = () => {
    const parentElement = container.current
    if (!parentElement || !window.Calendly) {
      setStatus("failed")
      return
    }
    try {
      parentElement.replaceChildren()
      window.Calendly.initInlineWidget({ url, parentElement })
      setStatus("ready")
    } catch {
      setStatus("failed")
    }
  }

  return (
    <>
      <Script
        src={CALENDLY_WIDGET_SRC}
        strategy="afterInteractive"
        onReady={init}
        onError={() => setStatus("failed")}
      />
      {status === "failed" ? (
        <p className="mt-10 text-sm text-muted">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Book a meeting
          </a>
        </p>
      ) : (
        <div
          ref={container}
          aria-label="Book a meeting with the Superserve team"
          // Calendly switches to its two-column layout at about 1000px wide.
          className="mt-10 h-[720px] w-full min-w-[320px] border border-dashed border-border"
        />
      )}
    </>
  )
}

export function PendingReview({
  name,
  email,
  meeting,
}: {
  name?: string
  email?: string
  meeting: EnterpriseMeeting
}) {
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const scheduled = useCallback(() => {
    setChecking(true)
    router.refresh()
  }, [router])

  // Clears any session left in the browser; setup gates every route anyway.
  useEffect(() => {
    void createBrowserClient()
      .auth.signOut({ scope: "local" })
      .catch(() => {})
  }, [])

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1120px] px-5 py-8 sm:px-10">
        <Link href="/" className="inline-block">
          <Image
            src="/logo.svg"
            alt="Superserve"
            width={120}
            height={24}
            className="h-6 w-auto"
          />
        </Link>
        <div className="mt-14">
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
            Let&apos;s set up your Enterprise plan
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
            {meeting.state === "booked"
              ? "Your meeting with our team is scheduled. Your account stays on hold until our team approves it."
              : "Thanks for signing up. Your account is being set up."}{" "}
            We&apos;ll email
            {email ? (
              <>
                {" "}
                <strong className="text-foreground">{email}</strong>
              </>
            ) : (
              " you"
            )}{" "}
            as soon as your account is ready.
          </p>
        </div>
        {meeting.state === "booked" ? (
          <section
            className="mt-10 max-w-2xl border border-dashed border-border p-6"
            aria-label="Your existing meeting"
          >
            <h2 className="text-xl font-medium">Your meeting is scheduled</h2>
            <p className="mt-3 text-sm">
              <time dateTime={meeting.startTime}>
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "full",
                  timeStyle: "short",
                  timeZone: "UTC",
                }).format(new Date(meeting.startTime))}{" "}
                UTC
              </time>
            </p>
            {meeting.rescheduleUrl ? (
              <a
                href={meeting.rescheduleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block underline underline-offset-2"
              >
                Change or reschedule meeting
              </a>
            ) : (
              <p className="mt-4 text-sm text-muted">
                To change this meeting, use your Calendly confirmation email.
              </p>
            )}
          </section>
        ) : meeting.state === "not_booked" && !checking ? (
          <CalendlyEmbed
            url={calendlyBookingUrl(name, email)}
            onScheduled={scheduled}
          />
        ) : (
          <section className="mt-10 max-w-2xl text-sm" aria-live="polite">
            {meeting.state === "signin_required" ? (
              <Link href="/auth/signin?next=%2F" className="underline">
                Sign in to check your existing meeting
              </Link>
            ) : (
              <p>
                {checking
                  ? "Checking your meeting. Use your Calendly confirmation email while we verify it."
                  : "We couldn’t check your meeting. If you’ve already booked, use your Calendly confirmation email before booking again."}
              </p>
            )}
          </section>
        )}
        {meeting.state !== "signin_required" && (
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-6 text-sm underline underline-offset-2"
          >
            Refresh meeting
          </button>
        )}
      </div>
    </main>
  )
}
