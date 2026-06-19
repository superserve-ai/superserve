import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  FileListingUnavailableError,
  filenameFromContentDisposition,
  filesUrl,
  isValidAbsolutePath,
  joinPath,
  listDir,
  parentPath,
  pathSegments,
  sortEntries,
  uploadFileTo,
  type DirEntry,
} from "./files"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

const sandbox = { id: "sbx-1", access_token: "tok-abc" }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("path helpers", () => {
  it("filesUrl encodes the path and appends params", () => {
    const url = filesUrl("sbx-1", "/home/user/a b.txt", { format: "json" })
    expect(url).toContain("boxd-sbx-1.")
    expect(url).toContain("/files?path=%2Fhome%2Fuser%2Fa%20b.txt")
    expect(url).toContain("format=json")
  })

  it("isValidAbsolutePath rejects relative and traversal paths", () => {
    expect(isValidAbsolutePath("/home/user")).toBe(true)
    expect(isValidAbsolutePath("home/user")).toBe(false)
    expect(isValidAbsolutePath("/home/../etc")).toBe(false)
    expect(isValidAbsolutePath("/home/./x")).toBe(false)
  })

  it("joinPath joins a dir and a name with exactly one slash", () => {
    expect(joinPath("/home/user", "a.txt")).toBe("/home/user/a.txt")
    expect(joinPath("/home/user/", "a.txt")).toBe("/home/user/a.txt")
    expect(joinPath("/", "a.txt")).toBe("/a.txt")
  })

  it("parentPath climbs one level and bottoms out at root", () => {
    expect(parentPath("/home/user/dir")).toBe("/home/user")
    expect(parentPath("/home/user/dir/")).toBe("/home/user")
    expect(parentPath("/home")).toBe("/")
    expect(parentPath("/")).toBe("/")
  })

  it("pathSegments yields cumulative crumbs", () => {
    expect(pathSegments("/home/user/proj")).toEqual([
      { name: "home", path: "/home" },
      { name: "user", path: "/home/user" },
      { name: "proj", path: "/home/user/proj" },
    ])
    expect(pathSegments("/")).toEqual([])
  })

  it("filenameFromContentDisposition reduces to a safe basename", () => {
    expect(filenameFromContentDisposition('attachment; filename="a.txt"')).toBe(
      "a.txt",
    )
    expect(
      filenameFromContentDisposition('attachment; filename="../../etc/passwd"'),
    ).toBe("passwd")
    expect(filenameFromContentDisposition(null)).toBeNull()
  })
})

describe("sortEntries", () => {
  it("orders directories before files, then alphabetically", () => {
    const entries: DirEntry[] = [
      { name: "zebra.txt", is_dir: false, size: 1, modified_unix: 0 },
      { name: "src", is_dir: true, size: 0, modified_unix: 0 },
      { name: "apple.txt", is_dir: false, size: 1, modified_unix: 0 },
      { name: "Docs", is_dir: true, size: 0, modified_unix: 0 },
    ]
    expect(sortEntries(entries).map((e) => e.name)).toEqual([
      "Docs",
      "src",
      "apple.txt",
      "zebra.txt",
    ])
  })

  it("does not mutate the input array", () => {
    const entries: DirEntry[] = [
      { name: "b", is_dir: false, size: 0, modified_unix: 0 },
      { name: "a", is_dir: false, size: 0, modified_unix: 0 },
    ]
    sortEntries(entries)
    expect(entries.map((e) => e.name)).toEqual(["b", "a"])
  })
})

describe("listDir", () => {
  beforeEach(() => fetchSpy.mockReset())

  it("requests format=json with the access token and returns sorted entries", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        entries: [
          { name: "b.txt", is_dir: false, size: 2, modified_unix: 10 },
          { name: "sub", is_dir: true, size: 0, modified_unix: 5 },
        ],
      }),
    )

    const entries = await listDir(sandbox, "/home/user")

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/files?path=%2Fhome%2Fuser")
    expect(url).toContain("format=json")
    expect(init.method).toBe("GET")
    expect(init.headers["X-Access-Token"]).toBe("tok-abc")
    expect(entries.map((e) => e.name)).toEqual(["sub", "b.txt"])
  })

  it("treats a missing entries array as empty", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}))
    expect(await listDir(sandbox, "/home/user")).toEqual([])
  })

  it("maps the legacy 400 directory message to FileListingUnavailableError", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { error: "use FilesystemService.ListDir for directories" },
        400,
      ),
    )
    await expect(listDir(sandbox, "/home/user")).rejects.toBeInstanceOf(
      FileListingUnavailableError,
    )
  })

  it("maps a 404 to a folder-not-found error", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: "file not found" }, 404))
    await expect(listDir(sandbox, "/home/user/missing")).rejects.toThrow(
      /not found/i,
    )
  })
})

describe("uploadFileTo", () => {
  beforeEach(() => fetchSpy.mockReset())

  it("POSTs the file to <dir>/<name> with the access token", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }))
    const file = new File(["hi"], "note.txt", { type: "text/plain" })

    const target = await uploadFileTo(sandbox, "/home/user", file)

    expect(target).toBe("/home/user/note.txt")
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/files?path=%2Fhome%2Fuser%2Fnote.txt")
    expect(url).not.toContain("format=")
    expect(init.method).toBe("POST")
    expect(init.headers["X-Access-Token"]).toBe("tok-abc")
    expect(init.body).toBe(file)
  })

  it("rejects a traversal target before calling fetch", async () => {
    const file = new File(["x"], "../escape.txt")
    await expect(uploadFileTo(sandbox, "/home/user", file)).rejects.toThrow(
      /absolute/i,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws the parsed upstream error on a non-OK response", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "disk full" }), { status: 507 }),
    )
    const file = new File(["x"], "a.txt")
    await expect(uploadFileTo(sandbox, "/home/user", file)).rejects.toThrow(
      /disk full/,
    )
  })
})
