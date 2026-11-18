import type { NextConfig } from "next"

import { defaultSandboxOrigin } from "./src/lib/sandbox-url"

// Fail the build, not the first sandbox page load, on an invalid
// NEXT_PUBLIC_SANDBOX_* value.
defaultSandboxOrigin()

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
  reactCompiler: true,
  trailingSlash: true,
  reactStrictMode: true,
  experimental: {
    // Custom routes match any case by default, so /INGEST/... would reach
    // the PostHog rewrite with the console's cookies. Only lowercase paths
    // rewrite now. The /user-management redirects below also match only
    // lowercase, which is the case of every link to them; app pages already
    // match by exact case.
    caseSensitiveRoutes: true,
  },
  async redirects() {
    return [
      { source: "/user-management", destination: "/team", permanent: true },
      {
        source: "/user-management/:path*",
        destination: "/team",
        permanent: true,
      },
    ]
  },
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
