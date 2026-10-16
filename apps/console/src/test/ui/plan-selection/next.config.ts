import { resolve } from "node:path"

import type { NextConfig } from "next"

const config: NextConfig = {
  trailingSlash: true,
  transpilePackages: ["@superserve/ui"],
  webpack(config) {
    config.resolve.alias["@"] = resolve(__dirname, "../../..")
    return config
  },
}
export default config
