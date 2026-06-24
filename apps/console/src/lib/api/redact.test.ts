import { describe, expect, it } from "vitest"

import { redactAccessTokens, stripAccessTokens } from "./redact"

describe("stripAccessTokens", () => {
  it("removes access_token from an object", () => {
    expect(stripAccessTokens({ id: "a", access_token: "x" })).toEqual({
      id: "a",
    })
  })
  it("removes access_token from every array element", () => {
    expect(
      stripAccessTokens([
        { id: "a", access_token: "x" },
        { id: "b", access_token: "y" },
      ]),
    ).toEqual([{ id: "a" }, { id: "b" }])
  })
  it("removes nested access_token", () => {
    expect(
      stripAccessTokens({ sandbox: { id: "a", access_token: "x" } }),
    ).toEqual({ sandbox: { id: "a" } })
  })
  it("leaves token-free values untouched", () => {
    expect(stripAccessTokens({ id: "a", name: "b" })).toEqual({
      id: "a",
      name: "b",
    })
  })
})

describe("redactAccessTokens", () => {
  it("strips the token from a JSON string", () => {
    const out = redactAccessTokens('{"id":"a","access_token":"secret"}')
    expect(out).not.toContain("secret")
    expect(JSON.parse(out)).toEqual({ id: "a" })
  })
  it("fails closed on a malformed JSON body that claims a token", () => {
    // Should never happen for our control plane, but if a body is unparseable
    // we must still not leak the credential.
    const out = redactAccessTokens('{"access_token":"secret" oops')
    expect(out).not.toContain("secret")
  })
})
