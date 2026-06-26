import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Bundle the workspace packages this app imports (they ship ESM from the
  // monorepo) so the server build resolves them cleanly on Vercel.
  transpilePackages: ["@superserve/mcp", "@superserve/sdk"],
  // No `trailingSlash`: MCP clients POST to the bare endpoint; a 308 redirect
  // to a trailing-slash URL would complicate third-party clients.
}

export default nextConfig
