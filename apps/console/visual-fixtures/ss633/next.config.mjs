import path from "node:path"
import { fileURLToPath } from "node:url"

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))
const consoleSource = path.resolve(fixtureRoot, "../../src")

export default {
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@/hooks/use-billing-context": path.join(
        fixtureRoot,
        "billing-context.ts",
      ),
      "@": consoleSource,
    }
    return config
  },
}
