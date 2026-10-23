import type { NextConfig } from "next"

import { defaultSandboxOrigin } from "./src/lib/sandbox-url"

// Fail the build, not the first sandbox page load, on an invalid
// NEXT_PUBLIC_SANDBOX_* value.
defaultSandboxOrigin()

// Production must name its signup review cutoff (checked before the build).
// Other builds without one hold every unmarked account created after the build.
const signupReviewStartsAt =
  process.env.SIGNUP_REVIEW_STARTS_AT ||
  (process.env.VERCEL_ENV === "production"
    ? ""
    : new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))
if (!process.env.SIGNUP_REVIEW_STARTS_AT && signupReviewStartsAt)
  console.warn(
    `SIGNUP_REVIEW_STARTS_AT is unset; using the build time ${signupReviewStartsAt}`,
  )

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
]

const nextConfig: NextConfig = {
  env: { SIGNUP_REVIEW_STARTS_AT: signupReviewStartsAt },
  reactCompiler: true,
  trailingSlash: true,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ]
  },
}

export default nextConfig
