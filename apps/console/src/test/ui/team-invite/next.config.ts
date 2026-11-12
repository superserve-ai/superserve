import { resolve } from "node:path"

import type { NextConfig } from "next"

const config: NextConfig = {
  trailingSlash: true,
  transpilePackages: ["@superserve/ui"],
  webpack(config) {
    const source = resolve(__dirname, "../../..")
    config.resolve.alias["@"] = source
    for (const name of ["use-team-management", "use-teams", "use-user"]) {
      config.resolve.alias[resolve(source, `hooks/${name}`)] = resolve(
        __dirname,
        "hooks.ts",
      )
    }
    config.resolve.alias[resolve(source, "components/query-provider")] =
      resolve(__dirname, "query-provider.ts")
    return config
  },
}
export default config
