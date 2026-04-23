#!/usr/bin/env bun
/**
 * Diagnose auth issues running e2e tests.
 *
 * Usage:
 *   SUPERSERVE_API_KEY=ss_live_... bun tests/sdk-e2e-ts/scripts/diagnose-auth.ts
 *   SUPERSERVE_API_KEY=... SUPERSERVE_BASE_URL=https://api.superserve.ai bun tests/sdk-e2e-ts/scripts/diagnose-auth.ts
 *
 * What it does:
 *  1. Reports which env vars are set
 *  2. Tests the key against prod AND staging with raw curl-equivalent
 *  3. Calls Sandbox.create via the SDK and reports the result
 *  4. Tells you what's wrong
 */

import { Sandbox } from "@superserve/sdk"

const PROD = "https://api.superserve.ai"
const STAGING = "https://api-staging.superserve.ai"

const apiKey = process.env.SUPERSERVE_API_KEY
const baseUrl = process.env.SUPERSERVE_BASE_URL

console.log("=== Env ===")
console.log("SUPERSERVE_API_KEY:", apiKey ? `set (length=${apiKey.length}, prefix=${apiKey.slice(0, 8)}..., suffix=...${apiKey.slice(-4)})` : "NOT SET")
console.log("SUPERSERVE_BASE_URL:", baseUrl ?? "(default → prod)")

if (!apiKey) {
  console.error("\nSUPERSERVE_API_KEY is not set. Export it and try again.")
  process.exit(1)
}

async function probe(label: string, url: string): Promise<void> {
  try {
    const res = await fetch(`${url}/sandboxes`, {
      method: "GET",
      headers: { "X-API-Key": apiKey! },
    })
    const body = await res.text()
    console.log(`  ${label} (${url}) → ${res.status}`)
    if (res.status !== 200) console.log(`    body: ${body.slice(0, 150)}`)
  } catch (err) {
    console.log(`  ${label} (${url}) → error: ${(err as Error).message}`)
  }
}

console.log("\n=== Raw fetch probe ===")
await probe("prod    ", PROD)
await probe("staging ", STAGING)

console.log("\n=== SDK probe (Sandbox.list) ===")
try {
  const list = await Sandbox.list({ apiKey, baseUrl })
  console.log(`  OK — returned ${list.length} sandboxes`)
} catch (err: any) {
  console.log(`  FAIL — ${err.name}: ${err.message}`)
}

console.log("\n=== Diagnosis ===")
const resolved = baseUrl ?? PROD
if (resolved === PROD) {
  console.log("  Your SDK will hit PRODUCTION.")
  console.log("  If the raw prod probe above returned 401, your key is not valid for production.")
  console.log("  If the raw staging probe returned 200, your key is for staging — set SUPERSERVE_BASE_URL=" + STAGING)
} else {
  console.log("  Your SDK will hit:", resolved)
  console.log("  If the raw probe at that URL returned 401, your key is not valid for that environment.")
}
