import type { Metadata } from "next"

import { INVITE_PAGE_TITLE } from "@/lib/invite/copy"

export const metadata: Metadata = {
  title: INVITE_PAGE_TITLE,
  // The path carries a bearer-style token: keep it out of indexes and referrers.
  // Under no-referrer, native form POSTs send Origin: null and Next rejects
  // the server action, so send only the origin instead.
  robots: { index: false, follow: false },
  referrer: "strict-origin",
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
