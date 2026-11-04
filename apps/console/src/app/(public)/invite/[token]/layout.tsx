import type { Metadata } from "next"

import { INVITE_PAGE_TITLE } from "@/lib/invite/copy"

export const metadata: Metadata = {
  title: INVITE_PAGE_TITLE,
  // The path carries a bearer-style token: keep it out of indexes and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
