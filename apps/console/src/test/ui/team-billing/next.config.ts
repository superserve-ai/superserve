import { resolve } from "node:path"

import type { NextConfig } from "next"

const config: NextConfig = {
  trailingSlash: true,
  transpilePackages: ["@superserve/ui"],
  webpack(config) {
    config.resolve.alias["@"] = resolve(__dirname, "../../..")
    config.resolve.alias[
      resolve(
        __dirname,
        "../../../app/(dashboard)/admin/billing/teams/[team_id]/actions.ts",
      )
    ] = resolve(__dirname, "actions.ts")
    return config
  },
}
export default config
