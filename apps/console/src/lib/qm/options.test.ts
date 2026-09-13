import { describe, expect, it } from "vitest"

import { DEFAULT_HARNESS, harnessAllowed } from "./options"

describe("harnessAllowed", () => {
  it("defaults to pi, which every provider supports", () => {
    expect(DEFAULT_HARNESS).toBe("pi")
    expect(harnessAllowed("pi", "anthropic")).toBe(true)
    expect(harnessAllowed("pi", "openai")).toBe(true)
    expect(harnessAllowed("pi", "openrouter")).toBe(true)
  })

  it("only offers vendor CLIs for their own provider", () => {
    expect(harnessAllowed("claude", "anthropic")).toBe(true)
    expect(harnessAllowed("claude", "openai")).toBe(false)
    expect(harnessAllowed("claude", "openrouter")).toBe(false)
    expect(harnessAllowed("codex", "openai")).toBe(true)
    expect(harnessAllowed("codex", "anthropic")).toBe(false)
  })

  it("offers opencode everywhere", () => {
    expect(harnessAllowed("opencode", "anthropic")).toBe(true)
    expect(harnessAllowed("opencode", "openrouter")).toBe(true)
  })
})
