import type { NextConfig } from "next"

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

const SANDBOX_API_URL = process.env.SANDBOX_API_URL ?? "https://api.superserve.ai"

const nextConfig: NextConfig = {
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
        source: "/api/sandboxes/:path*",
        destination: `${SANDBOX_API_URL}/sandboxes/:path*`,
      },
      {
        source: "/api/sandboxes",
        destination: `${SANDBOX_API_URL}/sandboxes`,
      },
      {
        source: "/api/health",
        destination: `${SANDBOX_API_URL}/health`,
      },
      {
        source: "/api/v1/:path*",
        destination: `${SANDBOX_API_URL}/v1/:path*`,
      },
    ]
  },
}

export default nextConfig
