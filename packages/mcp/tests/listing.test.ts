import { describe, expect, it } from "vitest"

import {
  buildFindCommand,
  parseFindOutput,
  parseLsOutput,
  shellQuote,
  validateAbsolutePath,
} from "../src/lib/listing.js"

describe("validateAbsolutePath", () => {
  it("accepts absolute, traversal-free paths", () => {
    expect(() => validateAbsolutePath("/app/main.py")).not.toThrow()
  })
  it("rejects relative paths", () => {
    expect(() => validateAbsolutePath("app/main.py")).toThrow()
  })
  it("rejects .. segments", () => {
    expect(() => validateAbsolutePath("/app/../etc/passwd")).toThrow()
  })
  it("rejects null bytes", () => {
    expect(() => validateAbsolutePath("/app/\0")).toThrow()
  })
})

describe("shellQuote", () => {
  it("single-quotes and escapes embedded quotes", () => {
    expect(shellQuote("/a/b")).toBe("'/a/b'")
    expect(shellQuote("/a'b")).toBe("'/a'\\''b'")
  })
})

describe("buildFindCommand", () => {
  it("emits a -printf find over the quoted path", () => {
    const cmd = buildFindCommand("/app")
    expect(cmd).toContain("find '/app'")
    expect(cmd).toContain("-printf")
    expect(cmd).toContain("-maxdepth 1")
  })
})

describe("parseFindOutput", () => {
  it("parses type, size, mtime, and name", () => {
    const out = "f\t123\t1700000000.5\tfile.txt\nd\t4096\t1700000001\tsub\n"
    const entries = parseFindOutput(out)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      name: "file.txt",
      type: "file",
      size: 123,
    })
    expect(entries[0].modified).toBe(
      new Date(1700000000.5 * 1000).toISOString(),
    )
    expect(entries[1]).toMatchObject({
      name: "sub",
      type: "directory",
      size: 4096,
    })
  })
  it("skips . and .. and malformed lines", () => {
    const out =
      "d\t4096\t1700000000\t.\nbogus-line\nf\t10\t1700000000\tok.txt\n"
    const entries = parseFindOutput(out)
    expect(entries.map((e) => e.name)).toEqual(["ok.txt"])
  })
})

describe("parseLsOutput", () => {
  it("parses ls -la --time-style=long-iso output", () => {
    const out = [
      "total 12",
      "drwxr-xr-x 2 user user 4096 2026-06-19 10:00 .",
      "drwxr-xr-x 5 user user 4096 2026-06-19 09:00 ..",
      "-rw-r--r-- 1 user user  123 2026-06-19 10:01 file.txt",
      "drwxr-xr-x 2 user user 4096 2026-06-19 10:02 subdir",
      "lrwxrwxrwx 1 user user    7 2026-06-19 10:03 link -> file.txt",
    ].join("\n")
    const entries = parseLsOutput(out)
    expect(entries.map((e) => e.name)).toEqual(["file.txt", "subdir", "link"])
    expect(entries[0]).toMatchObject({ type: "file", size: 123 })
    expect(entries[1].type).toBe("directory")
    expect(entries[2].type).toBe("symlink")
    expect(entries[0].modified).toBe("2026-06-19T10:01")
  })
})
