import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

// TODO(better-auth): Replace with Better Auth middleware session check

const PUBLIC_ROUTES = [
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/callback",
  "/auth/auth-code-error",
  "/device",
]

function matchesRoute(pathname: string, routes: string[]): boolean {
  const normalizedPathname = pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname
  return routes.some((route) => {
    const normalizedRoute = route.endsWith("/") ? route.slice(0, -1) : route
    return (
      normalizedPathname === normalizedRoute ||
      normalizedPathname.startsWith(`${normalizedRoute}/`)
    )
  })
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isPublicRoute = matchesRoute(pathname, PUBLIC_ROUTES)

  // TODO(better-auth): Check session from Better Auth here.
  // For now, allow all requests through. Auth is enforced nowhere
  // until Better Auth is wired in.
  const user = null // TODO(better-auth): get user from session

  if (!user && !isPublicRoute) {
    const signinUrl = request.nextUrl.clone()
    signinUrl.pathname = "/auth/signin"
    signinUrl.searchParams.set("next", pathname)
    return Response.redirect(signinUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
