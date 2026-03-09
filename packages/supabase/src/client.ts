import { createBrowserClient as _createBrowserClient } from "@supabase/ssr"

export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  }

  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN

  return _createBrowserClient(url, anonKey, {
    ...(cookieDomain && { cookieOptions: { domain: cookieDomain } }),
  })
}
