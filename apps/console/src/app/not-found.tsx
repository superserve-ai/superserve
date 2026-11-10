import { CompassIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@superserve/ui"
import type { Metadata } from "next"
import Link from "next/link"

import { StatusPage } from "@/components/status-page"

export const metadata: Metadata = {
  title: "Page not found",
}

// Signed-out visitors reach this page under public prefixes such as /device/;
// middleware redirects them to sign-in on other paths.
export default function NotFound() {
  return (
    <StatusPage
      icon={CompassIcon}
      code="404"
      title="Page not found"
      description="This page doesn't exist or has moved. Check the URL, or go back to the console."
    >
      <Button size="sm" render={<Link href="/sandboxes/" />}>
        Back to console
      </Button>
    </StatusPage>
  )
}
