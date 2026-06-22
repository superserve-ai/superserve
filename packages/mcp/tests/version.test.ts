import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { SERVER_VERSION } from "../src/constants.js"

describe("server version", () => {
  it("matches package.json version", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string }
    expect(SERVER_VERSION).toBe(pkg.version)
  })
})
