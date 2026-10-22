import { describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { excluder } from "../src/commands/files"
import { json, runCli, SANDBOX_ID, type RecordedRequest } from "./harness"

const activated = () =>
  json({
    id: SANDBOX_ID,
    name: "box",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    access_token: "tok",
  })

const isActivate = (r: RecordedRequest) =>
  r.url.pathname === `/sandboxes/${SANDBOX_ID}/activate`
const isData = (r: RecordedRequest) => r.url.pathname === "/files"

describe("files", () => {
  test("ls lists via the control plane without activating", async () => {
    const r = await runCli(["files", "ls", SANDBOX_ID], {
      fetch: (req) =>
        req.url.pathname === `/sandboxes/${SANDBOX_ID}/files`
          ? json({
              entries: [
                { name: "b.txt", is_dir: false, size: 3, modified_unix: 0 },
                { name: "src", is_dir: true, size: 0, modified_unix: 0 },
              ],
            })
          : undefined,
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests).toHaveLength(1)
    expect(r.requests[0].url.searchParams.get("path")).toBe("/home/user")
    const lines = r.stdout.trim().split("\n")
    expect(lines[1]).toContain("src/")
    expect(lines[2]).toContain("b.txt")
  })

  test("relative sandbox paths are rejected before any request", async () => {
    const r = await runCli(["files", "cat", SANDBOX_ID, "etc/passwd"])
    expect(r.exitCode).toBe(2)
    expect(r.requests).toHaveLength(0)
  })

  test("write sends stdin bytes unchanged", async () => {
    const content = "a\0b\r\nc\n\n"
    const r = await runCli(["files", "write", SANDBOX_ID, "/tmp/x"], {
      stdin: content,
      fetch: (req) =>
        isActivate(req) ? activated() : isData(req) ? json({}) : undefined,
    })
    expect(r.exitCode).toBe(0)
    const put = r.requests.find(isData)!
    expect(put.method).toBe("POST")
    expect(put.url.searchParams.get("path")).toBe("/tmp/x")
    expect(put.body).toBe(content)
  })

  test("download writes binary bytes exactly and never overwrites without --force", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ss-dl-"))
    const bytes = new Uint8Array([0, 0xff, 0xfe, 0x80, 0x0a, 0x0d])
    const fetch = (req: RecordedRequest) => {
      if (req.url.pathname === `/sandboxes/${SANDBOX_ID}/files`) {
        expect(req.url.searchParams.get("path")).toBe("/home/user")
        return json({
          entries: [
            { name: "a.bin", is_dir: false, size: 6, modified_unix: 0 },
          ],
        })
      }
      if (isActivate(req)) return activated()
      if (isData(req)) {
        expect(req.url.searchParams.get("format")).toBeNull()
        return new Response(bytes)
      }
    }
    const args = ["files", "download", SANDBOX_ID, "/home/user/a.bin", dir]
    const first = await runCli(args, { fetch })
    expect(first.exitCode).toBe(0)
    expect(new Uint8Array(readFileSync(join(dir, "a.bin")))).toEqual(bytes)

    writeFileSync(join(dir, "a.bin"), "keep")
    const again = await runCli(args, { fetch })
    expect(again.exitCode).toBe(5)
    expect(readFileSync(join(dir, "a.bin"), "utf8")).toBe("keep")
    expect(again.requests.some(isData)).toBe(false)
  })

  test("a directory downloads as a zip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ss-dlz-"))
    const r = await runCli(
      ["files", "download", SANDBOX_ID, "/home/user/out", join(dir, "o.zip")],
      {
        fetch: (req) => {
          if (req.url.pathname === `/sandboxes/${SANDBOX_ID}/files`)
            return json({
              entries: [
                { name: "out", is_dir: true, size: 0, modified_unix: 0 },
              ],
            })
          if (isActivate(req)) return activated()
          if (isData(req)) return new Response("PK")
        },
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests.find(isData)!.url.searchParams.get("format")).toBe("zip")
  })

  test("a symlinked or unlisted directory falls back to a zip", async () => {
    // The listing is lstat-based and capped, so the entry may be missing or
    // claim "file"; the server's 400 on reading a directory decides it.
    const dir = mkdtempSync(join(tmpdir(), "ss-dll-"))
    const r = await runCli(
      ["files", "download", SANDBOX_ID, "/home/user/link", dir],
      {
        fetch: (req) => {
          if (req.url.pathname === `/sandboxes/${SANDBOX_ID}/files`)
            return json({ entries: [] })
          if (isActivate(req)) return activated()
          if (isData(req))
            return req.url.searchParams.get("format") === "zip"
              ? new Response("PK")
              : json(
                  { error: { code: "bad_request", message: "is a directory" } },
                  400,
                )
        },
      },
    )
    expect(r.exitCode).toBe(0)
    expect(readFileSync(join(dir, "link.zip"), "utf8")).toBe("PK")
  })

  test("directory upload keeps relative paths, honours --exclude, skips symlinks", async () => {
    const root = mkdtempSync(join(tmpdir(), "ss-up-"))
    mkdirSync(join(root, "src/lib"), { recursive: true })
    mkdirSync(join(root, "node_modules/x"), { recursive: true })
    writeFileSync(join(root, "src/a.ts"), "a")
    writeFileSync(join(root, "src/lib/b.ts"), "bb")
    writeFileSync(join(root, "debug.log"), "x")
    writeFileSync(join(root, "node_modules/x/i.js"), "x")
    symlinkSync("/etc/hosts", join(root, "link"))
    const r = await runCli(
      [
        "cp",
        root,
        `${SANDBOX_ID}:/srv/app`,
        "--exclude",
        "node_modules",
        "--exclude",
        "*.log",
      ],
      {
        fetch: (req) =>
          isActivate(req) ? activated() : isData(req) ? json({}) : undefined,
      },
    )
    expect(r.exitCode).toBe(0)
    const paths = r.requests
      .filter(isData)
      .map((q) => q.url.searchParams.get("path"))
      .toSorted()
    expect(paths).toEqual(["/srv/app/src/a.ts", "/srv/app/src/lib/b.ts"])
    const b = r.requests.find((q) =>
      q.url.searchParams.get("path")?.endsWith("b.ts"),
    )
    expect(b?.body).toBe("bb")
    expect(r.stderr).toContain("link")
  })

  test("a failed upload names the file", async () => {
    const root = mkdtempSync(join(tmpdir(), "ss-upf-"))
    writeFileSync(join(root, "bad.txt"), "x")
    const r = await runCli(["files", "upload", SANDBOX_ID, root, "/srv"], {
      fetch: (req) =>
        isActivate(req)
          ? activated()
          : isData(req)
            ? json({ error: { code: "bad", message: "disk full" } }, 400)
            : undefined,
    })
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain("bad.txt")
    expect(r.stderr).toContain("disk full")
  })

  test("exclude globs", () => {
    const ex = excluder(["*.log", "dist/**", "a?c"])
    expect(ex("x/y/z.log")).toBe(true)
    expect(ex("dist/x/y.js")).toBe(true)
    expect(ex("src/dist/y.js")).toBe(false)
    expect(ex("abc")).toBe(true)
    expect(ex("abbc")).toBe(false)
  })
})
