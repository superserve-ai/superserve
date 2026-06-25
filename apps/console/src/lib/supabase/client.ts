import { createBrowserClient as _createBrowserClient } from "@supabase/ssr"

function isVercelPreviewHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app")
}

export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  }

  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
  const hostname = typeof window === "undefined" ? "" : window.location.hostname
  const cookieOptions =
    cookieDomain && !isVercelPreviewHost(hostname)
      ? { domain: cookieDomain }
      : undefined

  return _createBrowserClient(url, anonKey, {
    ...(cookieOptions && { cookieOptions }),
  })
}
