import { expect, it } from "vitest"

import { staffReturnPath } from "./staff-return-path"

it.each([
  ["/admin/yc", "/admin/yc"],
  ["/admin/yc/", "/admin/yc"],
  [
    "/admin/yc?claim=11111111-1111-4111-8111-111111111111",
    "/admin/yc?claim=11111111-1111-4111-8111-111111111111",
  ],
])("retains only the staff review locator: %s", (path, expected) => {
  expect(staffReturnPath(path)).toBe(expected)
})

it.each([
  null,
  "https://evil.example/admin/yc",
  "//evil.example/admin/yc",
  "/\\evil.example/admin/yc",
  "/admin/yc?claim=bad",
  "/admin/yc?claim=00000000-0000-0000-0000-000000000000",
  "/admin/yc?claim=11111111-1111-4111-8111-111111111111&claim=22222222-2222-4222-8222-222222222222",
  "/admin/yc?next=//evil.example",
  "/admin/yc?state=approved",
  "/admin/yc#approved",
  "/admin/yc/other",
  "/admin/yc/../teams",
])("rejects unsupported staff destinations: %s", (path) => {
  expect(staffReturnPath(path)).toBeNull()
})
