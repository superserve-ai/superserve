/**
 * files-section — the navigable file browser on the sandbox detail page.
 *
 * Covers:
 *   - Disabled gating for non-active sandboxes (paused / resuming)
 *   - Listing an active sandbox's directory (folders + files)
 *   - Descending into a folder (re-lists the subpath)
 *   - Downloading a file (format=zip, success toast + posthog)
 *   - Drag-drop upload onto the current directory and onto a folder row
 *   - Showing API error copy or stable fallback copy and logging listing failures
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"

import { ApiError } from "@/lib/api/client"
import type { SandboxResponse } from "@/lib/api/types"

const mockAddToast = vi.fn()
const mockCapture = vi.fn()

vi.mock("@superserve/ui", () => ({
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button type="button" {...props} />
  ),
  useToast: () => ({ addToast: mockAddToast }),
}))

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

// Stub every phosphor icon we render as a no-op element.
vi.mock("@phosphor-icons/react", () => {
  const Icon = () => <span />
  return {
    ArrowClockwiseIcon: Icon,
    CaretRightIcon: Icon,
    DownloadSimpleIcon: Icon,
    FileIcon: Icon,
    FilesIcon: Icon,
    FolderIcon: Icon,
    FolderOpenIcon: Icon,
    HouseIcon: Icon,
    PlayIcon: Icon,
    UploadSimpleIcon: Icon,
    WarningCircleIcon: Icon,
  }
})

vi.mock("@/lib/sandbox-utils", () => ({
  formatBytes: (n: number) => `${n}B`,
}))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)
URL.createObjectURL = vi.fn().mockReturnValue("blob:fake")
URL.revokeObjectURL = vi.fn()

import { FilesSection } from "./files-section"
import { listingErrorMessage } from "./files/file-browser"

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

const ENTRIES = [
  { name: "proj", is_dir: true, size: 0, modified_unix: 1718800000 },
  { name: "readme.md", is_dir: false, size: 12, modified_unix: 1718800000 },
]

function listingResponse(entries: typeof ENTRIES) {
  return new Response(JSON.stringify({ entries }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

// Route fetch by shape: listing (control-plane /api/.../files), upload (POST),
// download (data-plane ?format=zip).
function defaultFetch(url: string, init?: RequestInit) {
  if (url.includes("/api/sandboxes/") && url.includes("/files"))
    return Promise.resolve(listingResponse(ENTRIES))
  if (init?.method === "POST")
    return Promise.resolve(new Response(null, { status: 200 }))
  if (url.includes("format=zip")) {
    return Promise.resolve(
      new Response(new Blob([new Uint8Array([1, 2, 3])]), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="readme.md"' },
      }),
    )
  }
  return Promise.resolve(new Response(null, { status: 404 }))
}

function renderSection(
  sandbox: SandboxResponse = activeSandbox,
  { reactStrictMode = false } = {},
) {
  const client = new QueryClient({
    // useDirListing overrides `retry` (one retry for 5xx / network errors), so
    // drop the backoff delay to keep failure tests fast.
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(<FilesSection sandbox={sandbox} onStart={() => {}} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
    reactStrictMode,
  })
}

function fileDataTransfer(file: File) {
  // happy-dom has no real DataTransfer; supply the shape our handlers read.
  return { types: ["Files"], items: [], files: [file] }
}

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
    defaultFetch(String(url), init),
  )
  mockAddToast.mockReset()
  mockCapture.mockReset()
})

describe("FilesSection — gating", () => {
  it("shows the start hint when paused", () => {
    renderSection({ ...activeSandbox, status: "paused" })
    expect(screen.getByText(/Start the sandbox/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("shows a resuming message when resuming", () => {
    renderSection({ ...activeSandbox, status: "resuming" })
    expect(screen.getByText(/resuming/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("FileBrowser — listing & navigation", () => {
  it("lists the default directory's entries", async () => {
    renderSection()
    expect(await screen.findByText("proj/")).toBeInTheDocument()
    expect(screen.getByText("readme.md")).toBeInTheDocument()

    const [url] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain("/api/sandboxes/")
    expect(String(url)).toContain("/files/?path=%2Fhome%2Fuser")
  })

  it("descends into a folder and lists the subpath", async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByText("proj/"))

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([u]) =>
            String(u).includes("/api/sandboxes/") &&
            String(u).includes("path=%2Fhome%2Fuser%2Fproj"),
        ),
      ).toBe(true),
    )
  })
})

describe("FileBrowser — download", () => {
  it("downloads a file as format=zip and toasts success", async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByText("readme.md"))

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([u]) =>
            String(u).includes("path=%2Fhome%2Fuser%2Freadme.md") &&
            String(u).includes("format=zip"),
        ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining("Downloaded readme.md"),
        "success",
      ),
    )
    expect(mockCapture).toHaveBeenCalledWith(
      "file_download_succeeded",
      expect.objectContaining({ sandbox_id: "sbx-1" }),
    )
  })
})

describe("FileBrowser — drag-drop upload", () => {
  it("uploads a file dropped onto the current directory", async () => {
    renderSection()
    const body = await screen.findByLabelText(/Files in \/home\/user/)
    const file = new File(["hi"], "note.txt", { type: "text/plain" })

    fireEvent.drop(body, { dataTransfer: fileDataTransfer(file) })

    await waitFor(() => {
      const post = fetchSpy.mock.calls.find(
        ([, init]) => init?.method === "POST",
      )
      expect(post).toBeTruthy()
      expect(String(post?.[0])).toContain("path=%2Fhome%2Fuser%2Fnote.txt")
    })
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining("Uploaded"),
        "success",
      ),
    )
    expect(mockCapture).toHaveBeenCalledWith(
      "file_upload_succeeded",
      expect.objectContaining({ sandbox_id: "sbx-1", file_size: 2 }),
    )
  })

  it("uploads into the folder a file is dropped onto", async () => {
    renderSection()
    const folderLabel = await screen.findByText("proj/")
    const row = folderLabel.closest("div")
    expect(row).toBeTruthy()
    const file = new File(["x"], "inside.txt")

    fireEvent.drop(row as HTMLElement, { dataTransfer: fileDataTransfer(file) })

    await waitFor(() => {
      const post = fetchSpy.mock.calls.find(
        ([, init]) => init?.method === "POST",
      )
      expect(post).toBeTruthy()
      // Uploaded into the dropped-on folder, not the current directory.
      expect(String(post?.[0])).toContain(
        "path=%2Fhome%2Fuser%2Fproj%2Finside.txt",
      )
    })
  })
})

describe("FileBrowser — listing errors", () => {
  const fallbackMessage = "This folder couldn't be loaded. Please try again."
  let consoleErrorSpy: MockInstance<typeof console.error>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it("surfaces the API error message when listing fails", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "not_found", message: "Folder not found." },
          }),
          { status: 404 },
        ),
      ),
    )
    renderSection()
    expect(await screen.findByText(/Folder not found/i)).toBeInTheDocument()
  })

  it("shows stable copy and logs an aborted listing request", async () => {
    const error = new DOMException(
      "signal is aborted without reason",
      "AbortError",
    )
    fetchSpy.mockRejectedValue(error)

    renderSection()

    expect(await screen.findByText(fallbackMessage)).toBeInTheDocument()
    expect(screen.queryByText(error.message)).not.toBeInTheDocument()
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to list folder", {
      error,
      path: "/home/user",
    })
  })

  it("shows stable copy and logs a primitive listing rejection once", async () => {
    fetchSpy.mockRejectedValue("Failed to fetch")

    const { rerender } = renderSection()

    expect(await screen.findByText(fallbackMessage)).toBeInTheDocument()
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to list folder", {
      error: "Failed to fetch",
      path: "/home/user",
    })

    rerender(
      <FilesSection
        sandbox={{ ...activeSandbox, name: "renamed" }}
        onStart={() => {}}
      />,
    )

    expect(screen.getByText(fallbackMessage)).toBeInTheDocument()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
  })

  it("shows stable copy when the API error message is blank", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: "not_found", message: "" } }),
          { status: 404, statusText: "Not Found" },
        ),
      ),
    )

    renderSection()

    expect(await screen.findByText(fallbackMessage)).toBeInTheDocument()
    expect(screen.queryByText("Not Found")).not.toBeInTheDocument()
  })

  it("shows stable copy for a non-JSON gateway response", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
        }),
      ),
    )

    renderSection()

    expect(await screen.findByText(fallbackMessage)).toBeInTheDocument()
    expect(screen.queryByText(/Bad Gateway/)).not.toBeInTheDocument()
  })

  it("logs the same error only once across StrictMode effects and a rerender", async () => {
    const error = new TypeError("Failed to fetch")
    fetchSpy.mockRejectedValue(error)
    const { rerender } = renderSection(activeSandbox, {
      reactStrictMode: true,
    })

    expect(await screen.findByText(fallbackMessage)).toBeInTheDocument()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    rerender(
      <FilesSection
        sandbox={{ ...activeSandbox, name: "renamed" }}
        onStart={() => {}}
      />,
    )

    expect(screen.getByText(fallbackMessage)).toBeInTheDocument()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
  })
})

describe("listingErrorMessage", () => {
  it.each(["not_found", "unknown_error"])(
    "returns the body message for an API error with code %s",
    (code) => {
      expect(
        listingErrorMessage(new ApiError(404, code, "Folder not found.", true)),
      ).toBe("Folder not found.")
    },
  )

  it("returns stable copy for an API error without a body message", () => {
    expect(
      listingErrorMessage(new ApiError(404, "not_found", "Not Found", false)),
    ).toBe("This folder couldn't be loaded. Please try again.")
  })

  it.each([
    ["an unknown API error", new ApiError(502, "unknown_error", "Bad Gateway")],
    ["a blank API message", new ApiError(404, "not_found", "")],
    ["a whitespace API message", new ApiError(404, "not_found", " \t\n ")],
    ["a plain Error", new Error("Failed to fetch")],
    ["a non-Error value", "Failed to fetch"],
    ["null", null],
  ])("returns stable copy for %s", (_, error) => {
    expect(listingErrorMessage(error)).toBe(
      "This folder couldn't be loaded. Please try again.",
    )
  })
})
