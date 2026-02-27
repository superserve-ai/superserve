import { createBrowserClient } from "@supabase/ssr"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const cookieDomain = import.meta.env.VITE_COOKIE_DOMAIN as string | undefined

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  cookieOptions: {
    ...(cookieDomain && { domain: cookieDomain }),
    path: "/",
    sameSite: "lax" as const,
    secure: true,
  },
})
