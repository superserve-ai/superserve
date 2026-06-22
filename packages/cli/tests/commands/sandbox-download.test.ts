import { afterEach, describe, expect, mock, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  defaultZipName,
  runDownload,
} from "../../src/commands/sandbox/download"

// Keep analytics off the network during tests.
process.env.DO_NOT_TRACK = "1"

describe("sandbox download - defaultZipName", () => {
  test("uses the directory basename with a .zip suffix", () => {
    expect(defaultZipName("/app/output", "sbx-1")).toBe("output.zip")
    expect(defaultZipName("/home/user/results", "sbx-1")).toBe("results.zip")
  })

  test("ignores trailing slashes", () => {
    expect(defaultZipName("/app/output/", "sbx-1")).toBe("output.zip")
  })

  test("falls back to sandbox-<id>.zip for the root path", () => {
    expect(defaultZipName("/", "sbx-9")).toBe("sandbox-sbx-9.zip")
    expect(defaultZipName("", "sbx-9")).toBe("sandbox-sbx-9.zip")
  })

  test("preserves ? and # — they are valid POSIX filename characters", () => {
    expect(defaultZipName("/app/report?draft", "sbx-1")).toBe(
      "report?draft.zip",
    )
    expect(defaultZipName("/app/v1#final", "sbx-1")).toBe("v1#final.zip")
    expect(defaultZipName("/app/#archive", "sbx-1")).toBe("#archive.zip")
  })
})

describe("sandbox download - runDownload", () => {
  const originalKey = process.env.SUPERSERVE_API_KEY

  afterEach(() => {
    mock.restore()
    if (originalKey === undefined) delete process.env.SUPERSERVE_API_KEY
    else process.env.SUPERSERVE_API_KEY = originalKey
  })

  test("throws when no API key is provided", async () => {
    delete process.env.SUPERSERVE_API_KEY
    await expect(runDownload("sbx-1", "/app", {})).rejects.toThrow(
      /Superserve API key/,
    )
  })

  test("connects, downloads the zip, and writes it to disk", async () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const connect = mock(async () => ({
      files: { downloadDir: mock(async () => zipBytes) },
    }))
    mock.module("@superserve/sdk", () => ({ Sandbox: { connect } }))

    const outFile = join(tmpdir(), `superserve-dl-test-${Date.now()}.zip`)
    try {
      await runDownload("sbx-1", "/app/output", {
        apiKey: "ss_live_test",
        output: outFile,
      })

      // Connected with the supplied key, then downloaded the requested dir.
      expect(connect).toHaveBeenCalledTimes(1)
      const [connectedId, connectOpts] = connect.mock.calls[0] as [
        string,
        { apiKey?: string },
      ]
      expect(connectedId).toBe("sbx-1")
      expect(connectOpts.apiKey).toBe("ss_live_test")

      // The zip bytes were written verbatim to the chosen path.
      expect(existsSync(outFile)).toBe(true)
      expect(Array.from(readFileSync(outFile))).toEqual(Array.from(zipBytes))
    } finally {
      rmSync(outFile, { force: true })
    }
  })
})
