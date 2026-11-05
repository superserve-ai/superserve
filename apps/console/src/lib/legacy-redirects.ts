import type { Redirect } from "next/dist/lib/load-custom-routes"

// Old bookmarks, emails and in-flight Stripe sessions still use /plan-usage.
export const legacyRedirects: Redirect[] = [
  {
    source: "/plan-usage",
    destination: "/billing-usage/",
    permanent: true,
  },
  {
    source: "/plan-usage/:path+",
    destination: "/billing-usage/:path+/",
    permanent: true,
  },
]
