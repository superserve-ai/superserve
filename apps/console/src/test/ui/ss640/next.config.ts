import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import type { NextConfig } from "next"

const sourceRoot = resolve(__dirname, "../../..")
const signupRoot = resolve(sourceRoot, "app/(auth)/auth/signup")
const browserDependencies = resolve(__dirname, "browser-dependencies.tsx")

const nextConfig: NextConfig = {
  // Match Console routing and the runner's exact declared case URLs.
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ["@superserve/ui"],
  env: {
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY: "synthetic-site-key",
    NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: "",
    NEXT_PUBLIC_WEBSITE_URL: "http://127.0.0.1:4173",
    SS640_FIXTURE_LOGO_SVG: readFileSync(
      resolve(sourceRoot, "../public/logo.svg"),
      "utf8",
    ),
  },
  async rewrites() {
    return [{ source: "/logo.svg", destination: "/api/fixture-logo" }]
  },
  webpack(config, { webpack }) {
    config.resolve.alias["@"] = sourceRoot
    // Substitute only signup's service/control boundaries. The page, capture
    // client, buttons, decorations and state transitions remain production code.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^(\.\/action|@\/app\/\(auth\)\/auth\/signup\/action|@superserve\/ui|posthog-js\/react|next\/script|@\/lib\/supabase\/client)$/,
        (resource: { context: string; request: string }) => {
          if (
            resource.context === signupRoot ||
            resource.request === "@/app/(auth)/auth/signup/action"
          ) {
            resource.request = browserDependencies
          }
        },
      ),
    )
    return config
  },
}

export default nextConfig
