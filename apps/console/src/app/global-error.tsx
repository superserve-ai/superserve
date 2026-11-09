"use client"

import { WarningCircleIcon } from "@phosphor-icons/react"
import { Button, buttonVariants, cn } from "@superserve/ui"
import { Geist_Mono, Instrument_Sans } from "next/font/google"

import { StatusPage } from "@/components/status-page"

import "./globals.css"

// global-error replaces the root layout, so it brings its own fonts and styles.
const sansFont = Instrument_Sans({
  subsets: ["latin"],
  variable: "--sans-font",
  display: "swap",
})

const monoFont = Geist_Mono({
  subsets: ["latin"],
  variable: "--mono-font",
  display: "swap",
})

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en" className={cn(sansFont.variable, monoFont.variable)}>
      <body className="font-sans antialiased">
        <title>Something went wrong | Superserve</title>
        <StatusPage
          icon={WarningCircleIcon}
          title="Something went wrong"
          description="The console failed to load. Try again, or reload the console from the start."
        >
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
          {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- full page load: the root layout itself failed, so client navigation can't be trusted */}
          <a
            href="/"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            Back to console
          </a>
        </StatusPage>
      </body>
    </html>
  )
}
