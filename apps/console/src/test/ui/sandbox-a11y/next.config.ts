import { resolve } from "node:path"

import type { NextConfig } from "next"

const sourceRoot = resolve(__dirname, "../../..")
const stubs = resolve(__dirname, "stubs.ts")
const queryStubs = resolve(__dirname, "query-stubs.ts")

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
        /^@\/hooks\/use-(templates|snapshots|secrets)$/,
        queryStubs,
      ),
    )
    return config
  },
}
export default config
