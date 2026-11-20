import { expect, it, vi } from "vitest"

import { accountTeamFallbackName } from "./account-team-name"
import { isPersonalTeam } from "./team-conversion"

vi.mock("@/lib/cells", () => ({ cellFor: vi.fn() }))

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "user@example.com",
}

it("recognizes the user's email without regard to case", () => {
  expect(isPersonalTeam({ name: "User@Example.com" }, user)).toBe(true)
})

it("recognizes the user's fallback account team", () => {
  expect(
    isPersonalTeam(
      { name: accountTeamFallbackName(user.email, user.id) },
      user,
    ),
  ).toBe(true)
})

it("rejects another user's fallback with the same email", () => {
  const name = accountTeamFallbackName(
    user.email,
    "22222222-2222-4222-8222-222222222222",
  )
  expect(isPersonalTeam({ name }, user)).toBe(false)
})

it("rejects custom teams and users without email", () => {
  expect(isPersonalTeam({ name: "custom" }, user)).toBe(false)
  expect(isPersonalTeam({ name: "user@example.com" }, { id: user.id })).toBe(
    false,
  )
})
