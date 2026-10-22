import { expect, it } from "vitest"

import { ycBrowserOrigin } from "./browser-origin"

it.each([
  ["https://console.example.test", "https://console.example.test"],
  ["https://console.example.test:8443/", "https://console.example.test:8443"],
  ["http://localhost:3000", "http://localhost:3000"],
  ["http://127.0.0.1:46300/", "http://127.0.0.1:46300"],
  ["http://127.0.0.1:3001", "http://127.0.0.1:3001"],
  ["http://[::1]:65535", "http://[::1]:65535"],
  ["http://localhost:80", "http://localhost"],
  ["http://[::1]", "http://[::1]"],
])("accepts the configured browser origin %s", (value, expected) => {
  expect(ycBrowserOrigin(value)).toBe(expected)
})

it.each([
  undefined,
  "",
  " http://localhost",
  "http://localhost\n",
  "http://example.test",
  "http://localhost.example.test",
  "http://auth.localhost",
  "http://localhost.",
  "http://127.1",
  "http://127.0.0.2",
  "http://2130706433",
  "http://0x7f000001",
  "http://0177.0.0.1",
  "http://%31%32%37.0.0.1",
  "http://[0:0:0:0:0:0:0:1]",
  "http://[::ffff:127.0.0.1]",
  "http://localhost:0",
  "http://localhost:65536",
  "http://localhost:-1",
  "http://localhost:03000",
  "http://localhost:",
  "http://localhost:3e3",
  "http://user@localhost",
  "http://@localhost",
  "http://localhost/yc",
  "http://localhost/a/..",
  "http://localhost?",
  "http://localhost#",
  "http://localhost\\evil",
  "https://user@console.example.test",
  "https://@console.example.test",
  "https://console.example.test/yc",
  "https://console.example.test?",
  "https://console.example.test#",
  "//localhost:3000",
])("rejects an unsafe or missing browser origin %j", (value) => {
  expect(ycBrowserOrigin(value)).toBeNull()
})
