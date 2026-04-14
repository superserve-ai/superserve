import { describe, it, expect } from "vitest"
import { createClient, hasCredentials } from "../src/client.js"

describe.skipIf(!hasCredentials())("system", () => {
  it("health() returns a successful response", async () => {
    const client = createClient()
    const health = await client.system.health()
    expect(health).toBeDefined()
  })
})
