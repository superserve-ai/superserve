import { createServerClient as _createServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"

function isVercelPreviewHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app")
}

export async function createServerClient() {
  const cookieStore = await cookies()
  const headerStore = await headers()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  }

  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
  const hostname = (headerStore.get("host") ?? "").split(":")[0]
  const domainOpts =
    cookieDomain && !isVercelPreviewHost(hostname)
      ? { domain: cookieDomain }
      : {}

  return _createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, { ...options, ...domainOpts })
          }
        } catch {
          // Called from Server Component — safe to ignore with middleware session refresh
        }
      },
    },
  })
}
