"use client"

import Image from "next/image"
import Link from "next/link"
import Script from "next/script"
import { useEffect, useRef, useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
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
  if (name) url.searchParams.set("name", name)
  if (email) url.searchParams.set("email", email)
  return url.toString()
}

function CalendlyEmbed({ url }: { url: string }) {
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
        <p className="mt-6 text-center text-xs text-muted">
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
          className="mt-6 h-[660px] min-w-[320px] border border-dashed border-border"
        />
      )}
    </>
  )
}

export function PendingReview({
  name,
  email,
  signOut = false,
}: {
  name?: string
  email?: string
  // Clears any session left in the browser; review gates every route anyway.
  signOut?: boolean
}) {
  useEffect(() => {
    if (!signOut) return
    void createBrowserClient()
      .auth.signOut({ scope: "local" })
      .catch(() => {})
  }, [signOut])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <DitherBackground />
      <div className="relative w-full max-w-2xl border border-dashed border-border bg-surface p-6">
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
        <h1 className="text-center text-sm font-medium text-foreground">
          Pending review
        </h1>
        <p className="mx-auto mt-2 max-w-md text-center text-xs leading-relaxed text-muted">
          Thanks for signing up. We&apos;ll review your request and email
          {email ? (
            <>
              {" "}
              <strong className="text-foreground">{email}</strong>
            </>
          ) : (
            " you"
          )}{" "}
          when it&apos;s approved. Want to get started sooner? Book a time with
          our team below.
        </p>
        <CalendlyEmbed url={calendlyBookingUrl(name, email)} />
      </div>
    </div>
  )
}
