import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { SuperserveClient } from "@superserve/sdk"
import { createClient, hasCredentials, RUN_ID } from "../src/client.js"
import { waitForStatus } from "../src/polling.js"

/**
 * End-to-end tests for `client.files.uploadFile` and `client.files.downloadFile`.
 *
 * Files hit the data-plane edge proxy directly at
 * `boxd-{sandbox_id}.sandbox.superserve.ai`, bypassing the control plane,
 * and authenticate with the per-sandbox `access_token` from `SandboxResponse`.
 *
 * Fern's generator doesn't support per-call `baseUrl` overrides, so the test
 * constructs a second `SuperserveClient` pointing at the sandbox's data-plane
 * host. The `X-Access-Token` header is carried on the generated request type
 * as a required field. See `spec/2026-04-16-sdk-fern-files-overlay-design.md`
 * for the full design.
 */
describe.skipIf(!hasCredentials())("files", () => {
  const name = `sdk-e2e-files-${RUN_ID}`
  let client: SuperserveClient
  let dataPlaneClient: SuperserveClient
  let sandboxId: string
  let accessToken: string

  beforeAll(async () => {
    client = createClient()
    const sandbox = await client.sandboxes.createSandbox({ name })
    if (!sandbox.id) throw new Error("createSandbox did not return an id")
    if (!sandbox.access_token) {
      throw new Error("createSandbox did not return an access_token")
    }
    sandboxId = sandbox.id
    accessToken = sandbox.access_token

    // Build a per-sandbox data-plane client. Only used for files.* calls.
    // apiKey is still passed (BaseClient expects it) but the data-plane
    // server ignores X-API-Key and checks X-Access-Token instead.
    dataPlaneClient = new SuperserveClient({
      apiKey: process.env.SUPERSERVE_API_KEY!,
      baseUrl: `https://boxd-${sandboxId}.sandbox.superserve.ai`,
    })

    await waitForStatus(client, sandboxId, "active")
  })

  afterAll(async () => {
    if (!sandboxId) return
    try {
      await client.sandboxes.deleteSandbox({ sandbox_id: sandboxId })
    } catch (err) {
      console.error(`Cleanup failed for sandbox ${sandboxId}:`, err)
    }
  })

  it("round-trips a small file through upload → download", async () => {
    const content = `hello-from-e2e-${RUN_ID}\n`
    const bytes = new TextEncoder().encode(content)

    // NOTE: Fern's TS generator drops the X-Access-Token header parameter
    // from the request body type when the operation also has a binary
    // request body (bug). We pass it via requestOptions.headers instead.
    await dataPlaneClient.files.uploadFile(
      bytes,
      { path: "/home/user/e2e-probe.txt" },
      { headers: { "X-Access-Token": accessToken } },
    )

    const response = await dataPlaneClient.files.downloadFile({
      path: "/home/user/e2e-probe.txt",
      "X-Access-Token": accessToken,
    })

    // response is a core.BinaryResponse — a fetch-style wrapper with
    // .blob() / .arrayBuffer() / .stream() / .bytes() methods.
    const blob = await response.blob()
    const downloaded = await blob.text()

    expect(downloaded).toBe(content)
  })
})
