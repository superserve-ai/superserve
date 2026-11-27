import { resolve } from "node:path"

import type { NextConfig } from "next"

const sourceRoot = resolve(__dirname, "../../..")
const stubs = resolve(__dirname, "stubs.ts")
const activityStub = resolve(__dirname, "activity-stub.ts")
const apiKeysStub = resolve(__dirname, "api-keys-stub.ts")
const planActionsStub = resolve(__dirname, "plan-actions-stub.ts")
const navigationStub = resolve(__dirname, "navigation-stub.ts")

// Separate Next app. These substitutions are not part of Console.
const config: NextConfig = {
  trailingSlash: true,
  devIndicators: false,
  transpilePackages: ["@superserve/ui"],
  webpack(config, { webpack }) {
    config.resolve.alias["@"] = sourceRoot
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^posthog-js\/react$/, stubs),
      new webpack.NormalModuleReplacementPlugin(
        /^@\/lib\/api\/activity-actions$/,
        activityStub,
      ),
      new webpack.NormalModuleReplacementPlugin(
        /^(?:@\/lib\/api\/|\.\/)api-keys-actions$/,
        apiKeysStub,
      ),
      new webpack.NormalModuleReplacementPlugin(
        /^@\/lib\/billing\/plan-offers-actions$/,
        planActionsStub,
      ),
      // Only the choose-plan page gets the suspending useSearchParams.
      new webpack.NormalModuleReplacementPlugin(
        /^next\/navigation$/,
        (resource: { request: string; contextInfo: { issuer?: string } }) => {
          if (resource.contextInfo.issuer?.includes("choose-plan/page"))
            resource.request = navigationStub
        },
      ),
    )
    return config
  },
}
export default config
