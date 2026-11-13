// The sign-in pages must stay prebuilt: rendered per request, they show the
// form before its scripts run, so an early fill or click is lost.
import { readFileSync } from "node:fs"

const routes = Object.keys(
  JSON.parse(readFileSync(".next/prerender-manifest.json", "utf8")).routes,
)
const required = ["/auth/signin", "/auth/signup"]
const missing = required.filter((route) => !routes.includes(route))
if (missing.length > 0) {
  console.error(
    `Not prebuilt: ${missing.join(", ")}. Something in their layouts reads request data (cookies, headers).`,
  )
  process.exit(1)
}
