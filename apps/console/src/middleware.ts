import { type NextRequest, NextResponse } from "next/server"

import { isSignupReviewBlocked } from "@/lib/auth/signup-review"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
} from "@/lib/billing/pro-auth-return"
import { createMiddlewareClient, matchesRoute } from "@/lib/supabase/middleware"
import { ycReturnPath } from "@/lib/yc/return-path"
import { staffReturnPath } from "@/lib/yc/staff-return-path"

const PUBLIC_ROUTES = [
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/callback",
  "/auth/auth-code-error",
  "/auth/pending",
  "/device",
  "/yc/confirm",
  "/yc/claim",
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
    signinUrl.search = ""
    const billingPath = pathname + request.nextUrl.search
    const retainedBilling =
      proAuthReturnPath(billingPath) ?? starterAuthReturnPath(billingPath)
    const invalidBillingReturn =
      /^\/(?:billing\/pro|plan-usage\/buy-credit)\/?$/.test(pathname) &&
      (request.nextUrl.searchParams.has("billing_flow") ||
        request.nextUrl.searchParams.has("billing") ||
        request.nextUrl.searchParams.has("purchase") ||
        request.nextUrl.searchParams.has("purchase_id")) &&
      !retainedBilling
    signinUrl.searchParams.set(
      "next",
      invalidBillingReturn
        ? "/auth/auth-code-error/"
        : (retainedBilling ??
            ycReturnPath(pathname + request.nextUrl.search) ??
            (process.env.YC_STAFF_UI_ENABLED === "true"
              ? staffReturnPath(pathname + request.nextUrl.search)
              : null) ??
            pathname +
              (["/onboarding/plan", "/auth/choose-plan"].includes(
                pathname.replace(/\/$/, ""),
              )
                ? request.nextUrl.search
                : "")),
    )
    // Build the redirect on top of client.response so any refreshed Supabase
    // auth cookies (written by getUser() via setAll) survive the redirect.
    const redirect = NextResponse.redirect(signinUrl)
    for (const cookie of client.response.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

  // Review state rides on the user getUser() already returned, so this adds
  // no Auth round trip for anyone else.
  if (user && !isPublicRoute && isSignupReviewBlocked(user)) {
    await client.supabase.auth.signOut().catch(() => {})
    const pendingUrl = request.nextUrl.clone()
    pendingUrl.pathname = "/auth/pending"
    pendingUrl.search = ""
    const redirect = NextResponse.redirect(pendingUrl)
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
    // on every font/css/js request. /api is skipped too: every API route
    // authenticates its own request (and answers JSON, not a redirect to the
    // signin page), so the middleware getUser() was a second Supabase auth
    // round-trip on every API call — including the 10s sandbox list poll.
    // PostHog ingestion must reach the rewrite even before sign-in.
    "/((?!ingest(?:/|$)|api/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js|map)$).*)",
  ],
}
