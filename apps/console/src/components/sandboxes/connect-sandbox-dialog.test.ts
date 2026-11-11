/**
 * connect-sandbox-dialog — snippet rendering.
 *
 * Locks in the SDK code-snippets the console shows to users. Regressions
 * here would mean copy-pasted snippets don't actually work, which is both
 * a UX disaster and an SDK contract drift signal.
 */

import { describe, expect, it } from "vitest"

import {
  getConnectSnippet,
  INSTALL_COMMANDS,
  LANGUAGES,
} from "./connect-sandbox-dialog"

describe("LANGUAGES", () => {
  it("offers TypeScript and Python, and no Go", () => {
    const values = LANGUAGES.map((l) => l.value)
    expect(values).toEqual(["typescript", "python"])
    expect(values).not.toContain("go")
  })
})

describe("INSTALL_COMMANDS", () => {
  it("returns the expected package manager commands", () => {
    expect(INSTALL_COMMANDS.typescript).toBe("npm install @superserve/sdk")
    expect(INSTALL_COMMANDS.python).toBe("pip install superserve")
  })
})

describe("getConnectSnippet", () => {
  const SBX = "sbx-42"

  describe("typescript", () => {
    it("uses Sandbox.connect (not the old SuperserveClient)", () => {
      const snip = getConnectSnippet("typescript", SBX)
      expect(snip).toContain('import { Sandbox } from "@superserve/sdk"')
      expect(snip).toContain("Sandbox.connect(")
      expect(snip).not.toContain("SuperserveClient")
      expect(snip).not.toContain("new Superserve(")
    })

    it("uses sandbox.commands.run (not client.exec.command)", () => {
      const snip = getConnectSnippet("typescript", SBX)
      expect(snip).toContain("sandbox.commands.run(")
      expect(snip).not.toContain("client.exec.command")
      expect(snip).not.toContain("sandbox.exec(")
    })

    it("connects with only the sandbox id", () => {
      const snip = getConnectSnippet("typescript", SBX)
      expect(snip).toContain('Sandbox.connect("sbx-42")')
      expect(snip).not.toContain("apiKey")
    })

    it("documents the environment variable without embedding a key", () => {
      const snip = getConnectSnippet("typescript", SBX)
      expect(snip.split("\n").slice(0, 2)).toEqual([
        "// Set your API key in your shell first:",
        "// export SUPERSERVE_API_KEY=ss_live_...",
      ])
      expect(
        snip.split("\n").filter((line) => line.includes("ss_live_")),
      ).toEqual(["// export SUPERSERVE_API_KEY=ss_live_..."])
      expect(snip.match(/ss_live_/g)).toHaveLength(1)
      expect(snip).not.toContain("apiKey:")
      expect(snip).not.toContain("YOUR_API_KEY")
    })
  })

  describe("python", () => {
    it("imports Sandbox from superserve", () => {
      const snip = getConnectSnippet("python", SBX)
      expect(snip).toContain("from superserve import Sandbox")
      expect(snip).toContain("Sandbox.connect(")
      expect(snip).not.toContain("import Superserve")
    })

    it("uses sandbox.commands.run with sandbox id", () => {
      const snip = getConnectSnippet("python", SBX)
      expect(snip).toContain("sandbox.commands.run(")
      expect(snip).toContain(`"${SBX}"`)
      expect(snip).not.toContain("client.exec.command")
    })

    it("connects with only the sandbox id", () => {
      const snip = getConnectSnippet("python", SBX)
      expect(snip).toContain('Sandbox.connect("sbx-42")')
      expect(snip).not.toContain("api_key")
    })

    it("documents the environment variable without embedding a key", () => {
      const snip = getConnectSnippet("python", SBX)
      expect(snip.split("\n").slice(0, 2)).toEqual([
        "# Set your API key in your shell first:",
        "# export SUPERSERVE_API_KEY=ss_live_...",
      ])
      expect(
        snip.split("\n").filter((line) => line.includes("ss_live_")),
      ).toEqual(["# export SUPERSERVE_API_KEY=ss_live_..."])
      expect(snip.match(/ss_live_/g)).toHaveLength(1)
      expect(snip).not.toContain("apiKey:")
      expect(snip).not.toContain("YOUR_API_KEY")
    })
  })

  it("never emits Go code", () => {
    for (const lang of ["typescript", "python"] as const) {
      const snip = getConnectSnippet(lang, SBX)
      expect(snip).not.toContain("package main")
      expect(snip).not.toContain("func main")
      expect(snip).not.toContain("github.com/superserve")
    }
  })
})
