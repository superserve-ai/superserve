import { type NextRequest, NextResponse } from "next/server"

import { isSignupReviewBlocked } from "@/lib/auth/signup-review"
import { isBuyCreditPath } from "@/lib/billing/buy-credit-path"
import { legacyBillingUsagePath } from "@/lib/billing/legacy-billing-usage-path"
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
  "/auth/confirm",
  "/auth/auth-code-error",
  "/auth/pending",
  "/device",
  "/invite",
  "/yc/confirm",
  "/yc/claim",
]

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const legacyPath = legacyBillingUsagePath(pathname)
  // Old bookmarks, emails and in-flight Stripe sessions still use /plan-usage.
  if (legacyPath) {
    const url = request.nextUrl.clone()
    url.pathname = legacyPath
    return NextResponse.redirect(url, 308)
  }

  if (pathname === "/ingest" || pathname.startsWith("/ingest/")) {
    // Invite tokens appear in auth page URLs, and console cookies hold the
    // session and pending email-link tokens. The rewrite would forward both
    // headers to PostHog, which needs neither.
    const headers = new Headers(request.headers)
    headers.delete("referer")
    headers.delete("cookie")
    return NextResponse.next({ request: { headers } })
  }

  const client = createMiddlewareClient(request)
  if (!client.supabase) return client.response

  const {
    data: { user },
  } = await client.supabase.auth.getUser()

  const isPublicRoute = matchesRoute(pathname, PUBLIC_ROUTES)
  // The invite page is public so signed-out visitors can read it, but a
  // signed-in account held for review must still be stopped before it can join.
  const isInviteRoute = matchesRoute(pathname, ["/invite"])

  if (!user && !isPublicRoute) {
    const signinUrl = request.nextUrl.clone()
    signinUrl.pathname = "/auth/signin"
    signinUrl.search = ""
    const billingPath = pathname + request.nextUrl.search
    const retainedBilling =
      proAuthReturnPath(billingPath) ?? starterAuthReturnPath(billingPath)
    const invalidBillingReturn =
      (/^\/billing\/pro\/?$/.test(pathname) || isBuyCreditPath(pathname)) &&
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
              ([
                "/onboarding/plan",
                "/onboarding/payment",
                "/auth/choose-plan",
              ].includes(pathname.replace(/\/$/, ""))
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
  if (
    user &&
    (!isPublicRoute || isInviteRoute) &&
    isSignupReviewBlocked(user)
  ) {
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
    "/plan-usage/:path*",
    // Skip Next internals and other static assets so getUser() isn't called
    // on every font/css/js request. /api is skipped too: every API route
    // authenticates its own request (and answers JSON, not a redirect to the
    // signin page), so the middleware getUser() was a second Supabase auth
    // round-trip on every API call — including the 10s sandbox list poll.
    // PostHog uses its own matcher to strip Referer and bypass auth before the rewrite.
    "/((?!ingest(?:/|$)|api/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js|map)$).*)",
    "/ingest/:path*",
  ],
}
