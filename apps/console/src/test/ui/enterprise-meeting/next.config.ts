import { resolve } from "node:path"

import type { NextConfig } from "next"

const config: NextConfig = {
  trailingSlash: true,
  webpack(config) {
    config.resolve.alias["@/lib/supabase/client$"] = resolve(
      __dirname,
      "client.ts",
    )
    config.resolve.alias["@"] = resolve(__dirname, "../../..")
    return config
  },
}
export default config
