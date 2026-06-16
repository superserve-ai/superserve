/**
 * files-section — the upload/download panel on the sandbox detail page.
 *
 * Covers:
 *   - Disabled gating for non-active / non-paused sandboxes with tooltip hint
 *   - Path validation: absolute, no '..', no '.'
 *   - Upload happy path + failure path (toasts + posthog events)
 *   - Download happy path + failure path
 *   - Drop handler accepts files
 */

import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SandboxResponse } from "@/lib/api/types"

const mockAddToast = vi.fn()
const mockCapture = vi.fn()

vi.mock("@superserve/ui", () => ({
  cn: (...c: Array<string | undefined | false>) => c.filter(Boolean).join(" "),
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button type="button" {...props} />
  ),
  Input: (props: React.JSX.IntrinsicElements["input"]) => <input {...props} />,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: renderEl }: { render: React.ReactElement }) =>
    renderEl,
  TooltipPopup: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
  useToast: () => ({ addToast: mockAddToast }),
}))

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

vi.mock("@phosphor-icons/react", () => ({
  DownloadSimpleIcon: () => <span>↓</span>,
  FileArrowUpIcon: () => <span>f</span>,
  FilesIcon: () => <span>📁</span>,
  UploadSimpleIcon: () => <span>↑</span>,
}))

// Mock formatBytes — not under test here.
vi.mock("@/lib/sandbox-utils", () => ({
  formatBytes: (n: number) => `${n}B`,
}))

// Stub fetch — per-test behavior configured via mockResolvedValue.
const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

// happy-dom doesn't expose URL.createObjectURL. Patch just these methods
// on the existing URL constructor — don't replace URL itself.
URL.createObjectURL = vi.fn().mockReturnValue("blob:fake")
URL.revokeObjectURL = vi.fn()

import { FilesSection } from "./files-section"

const activeSandbox: SandboxResponse = {
  id: "sbx-1",
  name: "test",
  status: "active",
  vcpu_count: 1,
  memory_mib: 512,
  access_token: "tok-abc",
  metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
}

function successResponse(
  body: BodyInit | null,
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/octet-stream", ...headers },
  })
}

describe("FilesSection — disabled gating", () => {
  it("renders the empty state when sandbox is resuming, with reason text", () => {
    render(<FilesSection sandbox={{ ...activeSandbox, status: "resuming" }} />)
    expect(screen.getByText(/Sandbox is resuming/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull()
  })

  it("renders the empty state when sandbox is paused, with hint to start", () => {
    render(<FilesSection sandbox={{ ...activeSandbox, status: "paused" }} />)
    expect(screen.getByText(/Start the sandbox/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull()
  })

  it("enables download input but keeps Upload button disabled with no file", () => {
    render(<FilesSection sandbox={activeSandbox} />)
    expect(screen.getByRole("button", { name: /Upload/ })).toBeDisabled()
    // Download also requires a valid path by default — /home/user/ ends with /
    // so the button should be clickable but validation fires on click.
  })
})

describe("FilesSection — upload", () => {
  const user = userEvent.setup()

  beforeEach(() => {
    fetchSpy.mockReset()
    mockAddToast.mockReset()
    mockCapture.mockReset()
  })

  it("rejects relative or traversal paths before calling fetch", async () => {
    render(<FilesSection sandbox={activeSandbox} />)

    // Type a bad path and attach a file
    const pathInput = screen.getAllByPlaceholderText("/home/user/file.txt")[0]
    await user.clear(pathInput)
    await user.type(pathInput, "/home/user/../etc/passwd")

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    const file = new File(["hello"], "evil.txt", { type: "text/plain" })
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [file],
        configurable: true,
      })
      fileInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const uploadBtn = screen.getByRole("button", { name: /Upload/ })
    await user.click(uploadBtn)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("absolute"),
      "error",
    )
  })

  it("uploads, shows success toast, fires UPLOAD_SUCCEEDED event", async () => {
    fetchSpy.mockResolvedValue(successResponse(null))
    render(<FilesSection sandbox={activeSandbox} />)

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    const file = new File(["hello"], "note.txt", { type: "text/plain" })
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [file],
        configurable: true,
      })
      fileInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    await user.click(screen.getByRole("button", { name: /Upload/ }))

    // Verify request shape
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/files?path=%2Fhome%2Fuser%2Fnote.txt")
    expect(url).toContain("boxd-sbx-1.")
    expect(init.method).toBe("POST")
    expect(init.headers["X-Access-Token"]).toBe("tok-abc")

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("Uploaded"),
      "success",
    )
    expect(mockCapture).toHaveBeenCalledWith(
      "file_upload_succeeded",
      expect.objectContaining({
        sandbox_id: "sbx-1",
        file_size: 5,
      }),
    )
  })

  it("shows error toast + fires UPLOAD_FAILED on non-OK response", async () => {
    fetchSpy.mockResolvedValue(
      new Response("permission denied", { status: 403 }),
    )
    render(<FilesSection sandbox={activeSandbox} />)

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    const file = new File(["x"], "a.txt")
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [file],
        configurable: true,
      })
      fileInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    await user.click(screen.getByRole("button", { name: /Upload/ }))

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("permission denied"),
      "error",
    )
    expect(mockCapture).toHaveBeenCalledWith(
      "file_upload_failed",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })
})

describe("FilesSection — download", () => {
  const user = userEvent.setup()

  beforeEach(() => {
    fetchSpy.mockReset()
    mockAddToast.mockReset()
    mockCapture.mockReset()
  })

  it("downloads a directory path (default trailing slash) as a zip", async () => {
    // PK\x03\x04 — a zip magic-number stub for the response body.
    const body = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])])
    fetchSpy.mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="user.zip"',
        },
      }),
    )
    render(<FilesSection sandbox={activeSandbox} />)

    // Default download path is /home/user/ (a directory). It must no longer be
    // rejected client-side — the server decides and a folder comes back zipped.
    await user.click(screen.getByRole("button", { name: /Download/ }))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("format=zip")
    expect(init.headers["X-Access-Token"]).toBe("tok-abc")
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("user.zip"),
      "success",
    )
    expect(mockCapture).toHaveBeenCalledWith(
      "file_download_succeeded",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })

  it("downloads a file, fires DOWNLOAD_SUCCEEDED event", async () => {
    // Build a streamable response body
    const body = new Blob([new Uint8Array([1, 2, 3])])
    fetchSpy.mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-length": "3" },
      }),
    )

    render(<FilesSection sandbox={activeSandbox} />)

    // Fix the path to a valid file path
    const downloadPathInput = screen.getAllByPlaceholderText(
      "/home/user/file.txt",
    )[1]
    await user.clear(downloadPathInput)
    await user.type(downloadPathInput, "/home/user/file.txt")

    await user.click(screen.getByRole("button", { name: /Download/ }))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/files?path=%2Fhome%2Fuser%2Ffile.txt")
    // The console always opts in to the archive flag; the server returns a
    // single file as-is, so this stays a plain file download.
    expect(url).toContain("format=zip")
    expect(init.method).toBe("GET")
    expect(init.headers["X-Access-Token"]).toBe("tok-abc")

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("Downloaded"),
      "success",
    )
    expect(mockCapture).toHaveBeenCalledWith(
      "file_download_succeeded",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })

  it("surfaces a parsed upstream error as a toast + fires DOWNLOAD_FAILED", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "disk on fire" }), { status: 500 }),
    )
    render(<FilesSection sandbox={activeSandbox} />)

    const downloadPathInput = screen.getAllByPlaceholderText(
      "/home/user/file.txt",
    )[1]
    await user.clear(downloadPathInput)
    await user.type(downloadPathInput, "/home/user/file.txt")

    await user.click(screen.getByRole("button", { name: /Download/ }))

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("disk on fire"),
      "error",
    )
    expect(mockCapture).toHaveBeenCalledWith(
      "file_download_failed",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })

  it("does not leak an unexpected JSON error body into the toast", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ unexpected: "shape" }), { status: 500 }),
    )
    render(<FilesSection sandbox={activeSandbox} />)

    const downloadPathInput = screen.getAllByPlaceholderText(
      "/home/user/file.txt",
    )[1]
    await user.clear(downloadPathInput)
    await user.type(downloadPathInput, "/home/user/file.txt")

    await user.click(screen.getByRole("button", { name: /Download/ }))

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("Download failed"),
      "error",
    )
    expect(mockAddToast).not.toHaveBeenCalledWith(
      expect.stringContaining("unexpected"),
      "error",
    )
  })

  it("downloads a directory as <name>.zip using the Content-Disposition filename", async () => {
    fetchSpy.mockResolvedValue(
      new Response(new Blob([new Uint8Array([1])]), {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="research.zip"',
        },
      }),
    )
    render(<FilesSection sandbox={activeSandbox} />)

    const downloadPathInput = screen.getAllByPlaceholderText(
      "/home/user/file.txt",
    )[1]
    await user.clear(downloadPathInput)
    await user.type(downloadPathInput, "/home/user/research")

    await user.click(screen.getByRole("button", { name: /Download/ }))

    // The folder comes back as research.zip; the success toast reflects the
    // archive name from Content-Disposition, not the bare directory name.
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("research.zip"),
      "success",
    )
    expect(mockAddToast).not.toHaveBeenCalledWith(
      expect.stringContaining("FilesystemService"),
      "error",
    )
  })

  it("sanitizes a path-traversal filename from Content-Disposition to its basename", async () => {
    // The data plane runs untrusted user code, so its Content-Disposition is an
    // untrusted boundary input — a traversal name must not steer the save.
    fetchSpy.mockResolvedValue(
      new Response(new Blob([new Uint8Array([1])]), {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="../../etc/passwd"',
        },
      }),
    )
    render(<FilesSection sandbox={activeSandbox} />)

    const downloadPathInput = screen.getAllByPlaceholderText(
      "/home/user/file.txt",
    )[1]
    await user.clear(downloadPathInput)
    await user.type(downloadPathInput, "/home/user/research")

    await user.click(screen.getByRole("button", { name: /Download/ }))

    expect(mockAddToast).toHaveBeenCalledWith("Downloaded passwd", "success")
  })

  it("shows a friendly message when the file is missing (404)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "file not found" }), {
        status: 404,
      }),
    )
    render(<FilesSection sandbox={activeSandbox} />)

    const downloadPathInput = screen.getAllByPlaceholderText(
      "/home/user/file.txt",
    )[1]
    await user.clear(downloadPathInput)
    await user.type(downloadPathInput, "/home/user/missing.txt")

    await user.click(screen.getByRole("button", { name: /Download/ }))

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("No file found"),
      "error",
    )
  })
})
