import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test"
import * as fs from "node:fs"

// We need to mock fs functions before importing auth, but bun:test spyOn
// works on the module object after import. We spy on the fs module methods.
import {
  clearCredentials,
  getApiKey,
  isAuthenticated,
  saveApiKey,
} from "../../src/config/auth"

let existsSyncSpy: ReturnType<typeof spyOn>
let readFileSyncSpy: ReturnType<typeof spyOn>
let writeFileSyncSpy: ReturnType<typeof spyOn>
let mkdirSyncSpy: ReturnType<typeof spyOn>
let renameSyncSpy: ReturnType<typeof spyOn>
let unlinkSyncSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  existsSyncSpy = spyOn(fs, "existsSync")
  readFileSyncSpy = spyOn(fs, "readFileSync")
  writeFileSyncSpy = spyOn(fs, "writeFileSync").mockImplementation(() => {})
  mkdirSyncSpy = spyOn(fs, "mkdirSync").mockImplementation(() => "" as any)
  renameSyncSpy = spyOn(fs, "renameSync").mockImplementation(() => {})
  unlinkSyncSpy = spyOn(fs, "unlinkSync").mockImplementation(() => {})
  delete process.env.SUPERSERVE_API_KEY
})

afterEach(() => {
  mock.restore()
  delete process.env.SUPERSERVE_API_KEY
})

describe("getApiKey", () => {
  test("returns env var when SUPERSERVE_API_KEY is set", () => {
    process.env.SUPERSERVE_API_KEY = "env-key-123"
    const key = getApiKey()
    expect(key).toBe("env-key-123")
  })

  test("returns api_key from auth file", () => {
    existsSyncSpy.mockReturnValue(true)
    readFileSyncSpy.mockReturnValue('{"api_key": "file-key-456"}')

    const key = getApiKey()
    expect(key).toBe("file-key-456")
  })

  test("returns null when auth file does not exist", () => {
    existsSyncSpy.mockReturnValue(false)
    const key = getApiKey()
    expect(key).toBeNull()
  })

  test("returns null and deletes file when JSON is corrupt", () => {
    existsSyncSpy.mockReturnValue(true)
    readFileSyncSpy.mockReturnValue("not json at all")

    const key = getApiKey()
    expect(key).toBeNull()
    expect(unlinkSyncSpy).toHaveBeenCalled()
  })

  test("returns null and deletes file when api_key is missing", () => {
    existsSyncSpy.mockReturnValue(true)
    readFileSyncSpy.mockReturnValue('{"other_field": "value"}')

    const key = getApiKey()
    expect(key).toBeNull()
    expect(unlinkSyncSpy).toHaveBeenCalled()
  })

  test("returns null and deletes file when api_key is not a string", () => {
    existsSyncSpy.mockReturnValue(true)
    readFileSyncSpy.mockReturnValue('{"api_key": 12345}')

    const key = getApiKey()
    expect(key).toBeNull()
    expect(unlinkSyncSpy).toHaveBeenCalled()
  })

  test("env var takes precedence over file", () => {
    process.env.SUPERSERVE_API_KEY = "env-key"
    existsSyncSpy.mockReturnValue(true)
    readFileSyncSpy.mockReturnValue('{"api_key": "file-key"}')

    const key = getApiKey()
    expect(key).toBe("env-key")
    // Should not even read the file
    expect(readFileSyncSpy).not.toHaveBeenCalled()
  })
})

describe("saveApiKey", () => {
  test("creates directory and writes JSON with api_key", () => {
    saveApiKey("new-key-789")

    expect(mkdirSyncSpy).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
    })
    expect(writeFileSyncSpy).toHaveBeenCalledWith(
      expect.stringContaining(".tmp"),
      JSON.stringify({ api_key: "new-key-789" }, null, 2),
      { mode: 0o600 },
    )
    expect(renameSyncSpy).toHaveBeenCalled()
  })
})

describe("clearCredentials", () => {
  test("deletes auth file when it exists", () => {
    existsSyncSpy.mockReturnValue(true)
    clearCredentials()
    expect(unlinkSyncSpy).toHaveBeenCalled()
  })

  test("does nothing when auth file does not exist", () => {
    existsSyncSpy.mockReturnValue(false)
    clearCredentials()
    expect(unlinkSyncSpy).not.toHaveBeenCalled()
  })
})

describe("isAuthenticated", () => {
  test("returns true when api key exists in file", () => {
    existsSyncSpy.mockReturnValue(true)
    readFileSyncSpy.mockReturnValue('{"api_key": "some-key"}')

    expect(isAuthenticated()).toBe(true)
  })

  test("returns true when env var is set", () => {
    process.env.SUPERSERVE_API_KEY = "env-key"
    expect(isAuthenticated()).toBe(true)
  })

  test("returns false when no credentials", () => {
    existsSyncSpy.mockReturnValue(false)
    expect(isAuthenticated()).toBe(false)
  })
})
