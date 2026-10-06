import { resolve } from "node:path"

import type { NextConfig } from "next"

const sourceRoot = resolve(__dirname, "../../..")
const dependencies = resolve(__dirname, "dependencies.ts")

// This is a separate Next app. None of these substitutions are part of Console.
const config: NextConfig = {
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ["@superserve/ui"],
  webpack(config, { webpack }) {
    config.resolve.alias["@"] = sourceRoot
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^(@\/hooks\/use-user|@\/lib\/supabase\/client|@\/lib\/api\/teams-actions|@\/lib\/api\/billing-actions|posthog-js\/react)$/,
        dependencies,
      ),
    )
    return config
  },
}

export default config
