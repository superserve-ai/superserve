import { expect, it } from "vitest"

import {
  isReplacementTeamName,
  replacementTeamName,
  replacementTeamOperationId,
} from "./replacement-team"

const userId = "11111111-1111-4111-8111-111111111111"
const removedTeamId = "22222222-2222-4222-8222-222222222222"

it("derives a stable version 5 UUID with the RFC 4122 variant", () => {
  const operationId = replacementTeamOperationId(userId, removedTeamId)

  expect(operationId).toBe("62ba6e08-454f-5606-9d6b-b77fb2ddb305")
  expect(operationId).toBe(replacementTeamOperationId(userId, removedTeamId))
  expect(operationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(operationId).not.toBe(userId)
})

it("uses both the user and removed team to derive the operation id", () => {
  const operationId = replacementTeamOperationId(userId, removedTeamId)

  expect(operationId).not.toBe(
    replacementTeamOperationId(userId, "33333333-3333-4333-8333-333333333333"),
  )
  expect(operationId).not.toBe(
    replacementTeamOperationId(
      "44444444-4444-4444-8444-444444444444",
      removedTeamId,
    ),
  )
})

it.each([
  ["a", 245],
  ["é", 122],
  ["界", 81],
  ["😀", 61],
])(
  "cuts %s on code-point boundaries within 256 UTF-8 bytes",
  (character, count) => {
    const name = replacementTeamName(character.repeat(300), userId)

    expect(name).toBe(`${character.repeat(count)} (11111111)`)
    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(256)
    expect(
      Buffer.byteLength(name, "utf8") + Buffer.byteLength(character, "utf8"),
    ).toBeGreaterThan(256)
  },
)

it("preserves mixed multibyte code points up to the exact byte limit", () => {
  const prefix = `${"界".repeat(80)}😀a`
  const name = replacementTeamName(`${prefix}é`, userId)

  expect(name).toBe(`${prefix} (11111111)`)
  expect(Buffer.byteLength(name, "utf8")).toBe(256)
})

it.each([
  "00000000",
  "01234567",
  "89abcdef",
  "ffffffff",
  "abcdef12-3456-4789-abcd-0123456789ab",
  replacementTeamOperationId(userId, removedTeamId),
])("recognizes the suffix from %s regardless of email case", (suffixSource) => {
  const name = replacementTeamName("User@Example.com", suffixSource)

  expect(isReplacementTeamName(name, "user@example.com")).toBe(true)
  expect(isReplacementTeamName(name, "USER@EXAMPLE.COM")).toBe(true)
})

it("recognizes a truncated replacement name for a long multibyte email", () => {
  const email = `${"界".repeat(100)}@example.com`
  const name = replacementTeamName(email, userId)

  expect(isReplacementTeamName(name, email)).toBe(true)
})

it("rejects the plain email", () => {
  expect(isReplacementTeamName("user@example.com", "user@example.com")).toBe(
    false,
  )
})

it("rejects another email's replacement name", () => {
  const name = replacementTeamName("other@example.com", userId)

  expect(isReplacementTeamName(name, "user@example.com")).toBe(false)
})

it.each(["1234567g", "1234567", "123456789", "ABCDEF12"])(
  "rejects the invalid suffix %s",
  (suffix) => {
    expect(
      isReplacementTeamName(`user@example.com (${suffix})`, "user@example.com"),
    ).toBe(false)
  },
)
