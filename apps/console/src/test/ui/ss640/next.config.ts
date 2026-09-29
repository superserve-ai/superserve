import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Match Console routing and the runner's exact declared case URLs.
  trailingSlash: true,
  reactStrictMode: true,
}

export default nextConfig
