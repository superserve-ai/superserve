import {
  createMiddlewareClient,
  matchesRoute,
} from "@superserve/supabase/middleware"
import { type NextRequest, NextResponse } from "next/server"

const PUBLIC_ROUTES = [
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/callback",
  "/auth/auth-code-error",
  "/device",
]

export async function middleware(request: NextRequest) {
  const client = createMiddlewareClient(request)
  if (!client.supabase) return client.response

  const {
    data: { user },
  } = await client.supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isPublicRoute = matchesRoute(pathname, PUBLIC_ROUTES)

  if (!user && !isPublicRoute) {
    const signinUrl = request.nextUrl.clone()
    signinUrl.pathname = "/auth/signin"
    signinUrl.searchParams.set("next", pathname)
    // Build the redirect on top of client.response so any refreshed Supabase
    // auth cookies (written by getUser() via setAll) survive the redirect.
    const redirect = NextResponse.redirect(signinUrl)
    for (const cookie of client.response.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

  return client.response
}

export const config = {
  matcher: [
    // Skip Next internals and common static assets so getUser() isn't called
    // on every font/css/js request.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js|map)$).*)",
  ],
}
