"use client"

import {
  ArrowClockwiseIcon,
  FolderOpenIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { Button, useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { usePostHog } from "posthog-js/react"
import { useRef, useState } from "react"

import { useDirListing } from "@/hooks/use-dir-listing"
import {
  errorMessage,
  fileNameFromPath,
  filenameFromContentDisposition,
  filesUrl,
  FileListingUnavailableError,
  joinPath,
  uploadFileTo,
  type DirEntry,
} from "@/lib/api/files"
import { fileKeys } from "@/lib/api/query-keys"
import type { SandboxResponse } from "@/lib/api/types"
import { FILE_EVENTS } from "@/lib/posthog/events"

import { FileBreadcrumb } from "./file-breadcrumb"
import { FileRow } from "./file-row"

const DEFAULT_PATH = "/home/user"

/** Whether a drag carries OS files (vs. text / an in-page element). */
function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes("Files")
}

/**
 * Pull plain files out of a drop, skipping directories (folder upload is out of
 * scope). Must run synchronously inside the drop handler — DataTransferItem
 * entries are only valid during the event.
 */
function extractFiles(e: React.DragEvent): {
  files: File[]
  skippedDirectory: boolean
} {
  const dt = e.dataTransfer
  if (dt.items && dt.items.length > 0) {
    const files: File[] = []
    let skippedDirectory = false
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i]
      if (item.kind !== "file") continue
      if (item.webkitGetAsEntry?.()?.isDirectory) {
        skippedDirectory = true
        continue
      }
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    return { files, skippedDirectory }
  }
  return { files: Array.from(dt.files ?? []), skippedDirectory: false }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface FileBrowserProps {
  sandbox: SandboxResponse
}

/**
 * Navigable, drag-and-drop file browser for an active sandbox. Lists one
 * directory at a time (lazy, cached per path), downloads a file or folder
 * (folder → zip), and uploads OS files dropped onto the current directory or a
 * folder row.
 */
export function FileBrowser({ sandbox }: FileBrowserProps) {
  const { addToast } = useToast()
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const [path, setPath] = useState(DEFAULT_PATH)
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const [uploadingTo, setUploadingTo] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)

  const listing = useDirListing(sandbox, path)
  const entries = listing.data ?? []

  const openEntry = (entry: DirEntry) => {
    if (entry.is_dir) setPath(joinPath(path, entry.name))
  }

  const uploadInto = async (dirPath: string, files: File[]) => {
    if (files.length === 0) return
    setUploadingTo(dirPath)
    let succeeded = 0
    try {
      for (const file of files) {
        const startedAt = performance.now()
        try {
          await uploadFileTo(sandbox, dirPath, file)
          succeeded++
          posthog.capture(FILE_EVENTS.UPLOAD_SUCCEEDED, {
            sandbox_id: sandbox.id,
            file_size: file.size,
            duration_ms: Math.round(performance.now() - startedAt),
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed"
          posthog.capture(FILE_EVENTS.UPLOAD_FAILED, {
            sandbox_id: sandbox.id,
            file_size: file.size,
            error: message,
          })
          addToast(`${file.name}: ${message}`, "error")
        }
      }
      if (succeeded > 0) {
        const label = succeeded === 1 ? "1 file" : `${succeeded} files`
        addToast(`Uploaded ${label} to ${dirPath}`, "success")
        // Freshen the folder we wrote into: if it's the current view it
        // re-renders; if it's a subfolder its cache is ready for the next open.
        queryClient.invalidateQueries({
          queryKey: fileKeys.listing(sandbox.id, dirPath),
        })
      }
    } finally {
      setUploadingTo(null)
    }
  }

  const dropFilesInto = (dirPath: string, e: React.DragEvent) => {
    const { files, skippedDirectory } = extractFiles(e)
    if (files.length === 0) {
      if (skippedDirectory) {
        addToast(
          "Folder uploads aren't supported yet — drop individual files.",
          "error",
        )
      }
      return
    }
    void uploadInto(dirPath, files)
  }

  const downloadEntry = async (entry: DirEntry) => {
    const target = joinPath(path, entry.name)
    setDownloadingPath(target)
    const startedAt = performance.now()
    try {
      // Always opt in to format=zip: boxd returns a file as-is and a directory
      // as a zip, so one path covers both row types.
      const res = await fetch(filesUrl(sandbox.id, target, { format: "zip" }), {
        method: "GET",
        headers: { "X-Access-Token": sandbox.access_token },
      })
      if (!res.ok) {
        const detail = await errorMessage(
          res,
          `Download failed (${res.status})`,
        )
        if (res.status === 404) throw new Error(`No file found at "${target}"`)
        throw new Error(detail)
      }
      const blob = await res.blob()
      const filename =
        filenameFromContentDisposition(
          res.headers.get("content-disposition"),
        ) ?? fileNameFromPath(target)
      saveBlob(blob, filename)
      posthog.capture(FILE_EVENTS.DOWNLOAD_SUCCEEDED, {
        sandbox_id: sandbox.id,
        file_size: blob.size,
        duration_ms: Math.round(performance.now() - startedAt),
      })
      addToast(`Downloaded ${filename}`, "success")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed"
      posthog.capture(FILE_EVENTS.DOWNLOAD_FAILED, {
        sandbox_id: sandbox.id,
        error: message,
      })
      addToast(message, "error")
    } finally {
      setDownloadingPath(null)
    }
  }

  const handlePickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ""
    void uploadInto(path, files)
  }

  // Current-directory drop zone (the body). Folder rows stopPropagation on
  // their own drop, so this only fires for drops on empty space / file rows.
  const handleBodyDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    if (!isDraggingFiles) setIsDraggingFiles(true)
  }
  const handleBodyDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDraggingFiles(false)
    }
  }
  const handleBodyDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setIsDraggingFiles(false)
    dropFilesInto(path, e)
  }

  return (
    <div className="flex flex-col">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-border px-4">
        <FileBreadcrumb path={path} onNavigate={setPath} />
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploadingTo !== null}
          >
            <UploadSimpleIcon className="size-3.5" weight="light" />
            {uploadingTo !== null ? "Uploading..." : "Upload"}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => listing.refetch()}
            aria-label="Refresh"
          >
            <ArrowClockwiseIcon
              className={`size-3.5 ${listing.isFetching ? "animate-spin" : ""}`}
              weight="light"
            />
          </Button>
        </div>
      </div>

      <div
        onDragOver={handleBodyDragOver}
        onDragLeave={handleBodyDragLeave}
        onDrop={handleBodyDrop}
        aria-label={`Files in ${path}. Drop files here to upload.`}
        className={`relative min-h-[180px] ${
          isDraggingFiles ? "bg-brand/[0.04]" : ""
        }`}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center border border-dashed border-brand bg-background/50 px-4 text-center font-mono text-xs text-brand uppercase">
            Drop to upload to {path}
          </div>
        )}

        {listing.isPending ? (
          <ListSkeleton />
        ) : listing.error ? (
          <ListingError
            error={listing.error}
            onRetry={() => listing.refetch()}
          />
        ) : entries.length === 0 ? (
          <EmptyFolder />
        ) : (
          <div>
            {entries.map((entry) => (
              <FileRow
                key={entry.name}
                entry={entry}
                onOpen={openEntry}
                onDownload={downloadEntry}
                onDropIntoFolder={(folder, e) =>
                  dropFilesInto(joinPath(path, folder.name), e)
                }
                isDownloading={downloadingPath === joinPath(path, entry.name)}
              />
            ))}
          </div>
        )}
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        aria-label="Upload files to current directory"
        onChange={handlePickFiles}
      />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border/60 px-4 py-2"
        >
          <div className="size-4 shrink-0 animate-pulse bg-muted/30" />
          <div className="h-3 flex-1 animate-pulse bg-muted/20" />
          <div className="h-3 w-12 animate-pulse bg-muted/20" />
        </div>
      ))}
    </div>
  )
}

function EmptyFolder() {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <FolderOpenIcon className="size-8 text-muted" weight="light" />
      <p className="font-mono text-xs text-muted uppercase">
        Empty folder — drop files here to upload
      </p>
    </div>
  )
}

function ListingError({
  error,
  onRetry,
}: {
  error: Error
  onRetry: () => void
}) {
  const message =
    error instanceof FileListingUnavailableError
      ? "Directory listing isn't available for this sandbox yet."
      : error.message
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <WarningCircleIcon className="size-8 text-destructive" weight="light" />
      <p className="max-w-sm font-mono text-xs text-foreground/70">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
