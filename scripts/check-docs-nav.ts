#!/usr/bin/env bun
/**
 * Verifies the API Reference nav in docs/docs.json stays in sync with the
 * OpenAPI spec it points at. Fails if the spec documents an operation that
 * isn't listed in the nav (so it never renders), or if the nav lists an
 * operation the spec doesn't define (a stale or mistyped entry).
 *
 * The spec is fetched from the URL in docs.json, so this also enforces that a
 * nav entry can only land once the backing spec change is live.
 */

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]

// Paths defined in the spec but intentionally absent from the public nav.
const EXEMPT_PATHS = new Set(["/health"])

const OP_RE = new RegExp(`^(${HTTP_METHODS.join("|")}) /`)

type DocsConfig = {
  navigation: {
    tabs: Array<{
      tab: string
      openapi?: string
      groups?: Array<{ pages: unknown[] }>
    }>
  }
}

function navOpsFromDocs(docs: DocsConfig): {
  ops: Set<string>
  specUrl: string
} {
  const apiTab = docs.navigation.tabs.find((t) => typeof t.openapi === "string")
  if (!apiTab?.openapi) {
    throw new Error("no tab with an `openapi` field found in docs.json")
  }
  const ops = new Set<string>()
  for (const group of apiTab.groups ?? []) {
    for (const page of group.pages ?? []) {
      if (typeof page === "string" && OP_RE.test(page)) {
        ops.add(page.replace(/\s+/g, " ").trim())
      }
    }
  }
  return { ops, specUrl: apiTab.openapi }
}

function specOps(spec: {
  paths?: Record<string, Record<string, unknown>>
}): Set<string> {
  const ops = new Set<string>()
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const key of Object.keys(item)) {
      const method = key.toUpperCase()
      if (HTTP_METHODS.includes(method)) ops.add(`${method} ${path}`)
    }
  }
  return ops
}

const docsPath = new URL("../docs/docs.json", import.meta.url)
const docs = (await Bun.file(docsPath).json()) as DocsConfig
const { ops: nav, specUrl } = navOpsFromDocs(docs)

const res = await fetch(specUrl)
if (!res.ok) {
  console.error(`failed to fetch OpenAPI spec (${res.status}): ${specUrl}`)
  process.exit(1)
}
const spec = Bun.YAML.parse(await res.text()) as Parameters<typeof specOps>[0]
const api = specOps(spec)

const missingFromNav = [...api].filter((op) => {
  const path = op.split(" ", 2)[1]
  return !EXEMPT_PATHS.has(path) && !nav.has(op)
})
const missingFromSpec = [...nav].filter((op) => !api.has(op))

if (missingFromNav.length || missingFromSpec.length) {
  if (missingFromNav.length) {
    console.error(
      "Documented in the OpenAPI spec but missing from the docs nav:",
    )
    for (const op of missingFromNav.toSorted()) console.error(`  - ${op}`)
    console.error("Add these to the API Reference group in docs/docs.json.\n")
  }
  if (missingFromSpec.length) {
    console.error("Listed in the docs nav but not defined in the OpenAPI spec:")
    for (const op of missingFromSpec.toSorted()) console.error(`  - ${op}`)
    console.error("Remove these from docs/docs.json or fix the path/method.\n")
  }
  process.exit(1)
}

console.log(`docs nav in sync with OpenAPI spec (${api.size} operations).`)
