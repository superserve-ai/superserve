"use client"

import Image from "next/image"
import Link from "next/link"
import Script from "next/script"
import { useEffect, useRef, useState } from "react"

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
}: {
  name?: string
  email?: string
}) {
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
            Thanks for signing up. Book a time with our team below to set up
            your plan. We&apos;ll email
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
        <CalendlyEmbed url={calendlyBookingUrl(name, email)} />
      </div>
    </main>
  )
}
