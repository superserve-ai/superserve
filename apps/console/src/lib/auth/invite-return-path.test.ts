import { describe, expect, it } from "vitest"

import {
  inviteReturnPath,
  inviteTokenFromReturnPath,
  inviteTokenRegion,
  invitePath,
  isInviteToken,
} from "./invite-return-path"

const body = "A".repeat(43)
const useToken = `ssinv_use_${body}`
const uswToken = `ssinv_usw_${"a1_-".repeat(10)}abc`

describe("isInviteToken", () => {
  it.each([useToken, uswToken])("accepts %s", (token) => {
    expect(isInviteToken(token)).toBe(true)
  })

  it.each([
    "",
    "ssinv_use_",
    `ssinv_use_${"A".repeat(42)}`,
    `ssinv_use_${"A".repeat(44)}`,
    `ssinv_eu_${body}`,
    `ssinv_USE_${body}`,
    `ssinv_use-${body}`,
    `xssinv_use_${body}`,
    `${useToken}\n`,
    `${useToken}/`,
    `ssinv_use_${"A".repeat(42)}.`,
    `ssinv_use_${"A".repeat(42)}%`,
    null,
    undefined,
    42,
  ])("rejects %j", (token) => {
    expect(isInviteToken(token)).toBe(false)
  })
})

describe("inviteTokenRegion", () => {
  it("reads the region out of a valid token", () => {
    expect(inviteTokenRegion(useToken)).toBe("use")
    expect(inviteTokenRegion(uswToken)).toBe("usw")
  })

  it("returns null for an invalid token", () => {
    expect(inviteTokenRegion(`ssinv_eu_${body}`)).toBeNull()
  })
})

describe("invitePath", () => {
  it("builds the canonical path only for valid tokens", () => {
    expect(invitePath(useToken)).toBe(`/invite/${useToken}`)
    expect(invitePath("nope")).toBeNull()
  })
})

describe("inviteReturnPath", () => {
  it.each([`/invite/${useToken}`, `/invite/${useToken}/`])(
    "accepts %s and returns the canonical path",
    (raw) => {
      expect(inviteReturnPath(raw)).toBe(`/invite/${useToken}`)
    },
  )

  it.each([
    null,
    undefined,
    "",
    "/",
    "/invite",
    "/invite/",
    `invite/${useToken}`,
    `//invite/${useToken}`,
    `/\\invite/${useToken}`,
    `https://outside.test/invite/${useToken}`,
    `//outside.test/invite/${useToken}`,
    `/invite/${useToken}//`,
    `/invite/${useToken}/extra`,
    `/invite/${useToken}/join`,
    `/invite/${useToken}?next=https://outside.test`,
    `/invite/${useToken}#fragment`,
    `/invite/${useToken}%2F..%2F..%2Fadmin`,
    `/invite/../${useToken}`,
    `/invite/ssinv_eu_${body}`,
    `/invite/${body}`,
    `/device?code=${useToken}`,
    `/Invite/${useToken}`,
  ])("rejects %j", (raw) => {
    expect(inviteReturnPath(raw)).toBeNull()
  })
})

describe("inviteTokenFromReturnPath", () => {
  it("extracts the token from an invite return path", () => {
    expect(inviteTokenFromReturnPath(`/invite/${uswToken}/`)).toBe(uswToken)
  })

  it("returns null for anything else", () => {
    expect(inviteTokenFromReturnPath("/sandboxes")).toBeNull()
    expect(inviteTokenFromReturnPath(null)).toBeNull()
  })
})
