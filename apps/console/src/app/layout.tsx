import { cn, ToastProvider } from "@superserve/ui"
import type { Metadata } from "next"
import { Funnel_Display, Geist_Mono, Inter } from "next/font/google"
import { Suspense } from "react"
import { PostHogPageView } from "@/components/posthog-pageview"
import { PostHogProvider } from "@/components/posthog-provider"

import "./globals.css"

const displayFont = Funnel_Display({
  subsets: ["latin"],
  variable: "--display-font",
  display: "swap",
})

const sansFont = Inter({
  subsets: ["latin"],
  variable: "--sans-font",
  display: "swap",
})

const monoFont = Geist_Mono({
  subsets: ["latin"],
  variable: "--mono-font",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Superserve Console",
  description: "Deploy and manage your AI agents with Superserve",
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PostHogProvider>
      <html
        lang="en"
        className={cn(
          displayFont.variable,
          sansFont.variable,
          monoFont.variable,
        )}
      >
        <body className="font-sans antialiased" suppressHydrationWarning>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <ToastProvider>{children}</ToastProvider>
        </body>
      </html>
    </PostHogProvider>
  )
}
