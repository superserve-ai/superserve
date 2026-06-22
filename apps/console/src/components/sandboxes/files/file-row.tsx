"use client"

import { DownloadSimpleIcon, FileIcon, FolderIcon } from "@phosphor-icons/react"
import { useState } from "react"

import type { DirEntry } from "@/lib/api/files"
import { formatBytes } from "@/lib/sandbox-utils"

interface FileRowProps {
  entry: DirEntry
  onOpen: (entry: DirEntry) => void
  onDownload: (entry: DirEntry) => void
  /** Drop OS files onto a folder row; ignored for file rows. */
  onDropIntoFolder: (entry: DirEntry, e: React.DragEvent) => void
  isDownloading: boolean
}

function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes("Files")
}

function formatModified(unixSeconds: number): string {
  if (!unixSeconds) return ""
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

export function FileRow({
  entry,
  onOpen,
  onDownload,
  onDropIntoFolder,
  isDownloading,
}: FileRowProps) {
  const [isDropTarget, setIsDropTarget] = useState(false)
  const isDir = entry.is_dir

  // Folder rows accept OS-file drops (upload into that folder). preventDefault
  // on dragover marks the row a valid drop target; stopPropagation on drop keeps
  // the browser body's "upload to current dir" handler from also firing.
  const folderDropProps = isDir
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (hasFiles(e)) setIsDropTarget(true)
        },
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = "copy"
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsDropTarget(false)
          }
        },
        onDrop: (e: React.DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.stopPropagation()
          setIsDropTarget(false)
          onDropIntoFolder(entry, e)
        },
      }
    : {}

  return (
    <div
      {...folderDropProps}
      className={`group flex items-center gap-3 border-b border-border/60 px-4 py-2 transition-colors ${
        isDropTarget ? "border-brand bg-brand/10" : "hover:bg-foreground/[0.03]"
      }`}
    >
      {isDir ? (
        <FolderIcon className="size-4 shrink-0 text-brand" weight="light" />
      ) : (
        <FileIcon className="size-4 shrink-0 text-muted" weight="light" />
      )}

      <button
        type="button"
        onClick={() => (isDir ? onOpen(entry) : onDownload(entry))}
        title={isDir ? `Open ${entry.name}` : `Download ${entry.name}`}
        className="min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground hover:text-brand"
      >
        {entry.name}
        {isDir ? "/" : ""}
      </button>

      <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
        {formatModified(entry.modified_unix)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
        {isDir ? "—" : formatBytes(entry.size)}
      </span>

      <button
        type="button"
        onClick={() => onDownload(entry)}
        disabled={isDownloading}
        aria-label={
          isDir ? `Download ${entry.name} as zip` : `Download ${entry.name}`
        }
        className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 disabled:opacity-50"
      >
        <DownloadSimpleIcon className="size-3.5" weight="light" />
      </button>
    </div>
  )
}
