import { describe, expect, it } from "vitest"

import { ycReturnPath } from "./return-path"

describe("YC account return path", () => {
  it.each([
    "/yc/claim",
    "/yc/accept",
    "/yc/renewal",
    "/yc/accept?claim=11111111-1111-4111-8111-111111111111",
  ])("retains local locator %s", (path) =>
    expect(ycReturnPath(path)).toBe(path),
  )
  it.each([
    "https://evil.example/yc/accept",
    "//evil.example/yc/accept",
    "/\\evil.example/yc/accept",
    "/yc/accept?state=funding_ready",
    "/yc/accept?claim=bad",
    "/yc/accept#accepted",
    "/yc/accept/other",
    "/yc/accept?claim=11111111-1111-4111-8111-111111111111&claim=22222222-2222-4222-8222-222222222222",
    "/yc/accept?offer=yc_2026",
  ])("rejects %s", (path) => expect(ycReturnPath(path)).toBeNull())
})
