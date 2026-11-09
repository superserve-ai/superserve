import { CompassIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@superserve/ui"
import type { Metadata } from "next"
import Link from "next/link"

import { StatusPage } from "@/components/status-page"

export const metadata: Metadata = {
  title: "Page Not Found",
}

// Handles every unmatched URL. Signed-out visitors never get here: middleware
// sends them to sign-in first.
export default function NotFound() {
  return (
    <StatusPage
      icon={CompassIcon}
      code="404"
      title="Page not found"
      description="This page doesn't exist or has moved. Check the URL, or go back to the console."
    >
      <Button size="sm" render={<Link href="/" />}>
        Back to console
      </Button>
    </StatusPage>
  )
}
