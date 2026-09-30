import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import type { NextConfig } from "next"

const sourceRoot = resolve(__dirname, "../../..")
const signupRoot = resolve(sourceRoot, "app/(auth)/auth/signup")
const signinRoot = resolve(sourceRoot, "app/(auth)/auth/signin")
const callbackRoot = resolve(sourceRoot, "app/(auth)/auth/callback")
const serverDependencies = resolve(__dirname, "server-dependencies.ts")
const browserDependencies = resolve(__dirname, "browser-dependencies.tsx")

function isSignupSource(context: string, resource?: string): boolean {
  const prefix = `${signupRoot}/`
  return (
    context === signupRoot ||
    context.startsWith(prefix) ||
    resource?.startsWith(prefix) === true
  )
}

function isAuthSource(context: string, resource?: string): boolean {
  return (
    isSignupSource(context, resource) ||
    context === signinRoot ||
    context.startsWith(`${signinRoot}/`) ||
    resource?.startsWith(`${signinRoot}/`) === true
  )
}

const nextConfig: NextConfig = {
  // Match Console routing and the runner's exact declared case URLs.
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ["@superserve/ui"],
  env: {
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:4173",
    // The isolated browser runtime has no third-party script access. CAPTCHA
    // success/failure is supplied by the synthetic signup action below, so
    // the production form must not wait for a script that cannot load.
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY: "",
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
    // Keep production UI and hooks; replace external service boundaries locally.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^@\/lib\/api\/teams-actions$/,
        (resource: { context: string; request: string }) => {
          if (resource.context === resolve(sourceRoot, "hooks"))
            resource.request = resolve(__dirname, "team-dependencies.ts")
        },
      ),
      new webpack.NormalModuleReplacementPlugin(
        /^@\/(app\/\(auth\)\/auth\/(signin|signup)\/action|lib\/(supabase\/server|posthog\/actions|api\/(promotion-device-evidence|team-directory)|auth\/google-signup-proof|fingerprint\/binding-proof))$/,
        (resource: { context: string; request: string }) => {
          if (resource.context === callbackRoot)
            resource.request = serverDependencies
        },
      ),
      new webpack.NormalModuleReplacementPlugin(
        /^(\.\/action|@\/app\/\(auth\)\/auth\/signup\/action|@superserve\/ui|posthog-js\/react|next\/script|@\/lib\/supabase\/client)$/,
        (resource: { context: string; request: string; resource?: string }) => {
          if (
            isAuthSource(resource.context, resource.resource) ||
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
