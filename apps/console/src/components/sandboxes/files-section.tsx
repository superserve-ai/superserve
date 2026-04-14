"use client"

import {
  DownloadSimpleIcon,
  FileArrowUpIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import {
  Button,
  Input,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
  useToast,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useRef, useState } from "react"
import type { SandboxResponse } from "@/lib/api/types"
import { FILE_EVENTS } from "@/lib/posthog/events"
import { formatBytes } from "@/lib/sandbox-utils"

const SANDBOX_HOST =
  process.env.NEXT_PUBLIC_SANDBOX_HOST ?? "sandbox.superserve.ai"

function filesUrl(sandboxId: string, path: string): string {
  return `https://boxd-${sandboxId}.${SANDBOX_HOST}/files?path=${encodeURIComponent(path)}`
}

function fileNameFromPath(path: string): string {
  const clean = path.split(/[?#]/)[0]
  const parts = clean.split("/").filter(Boolean)
  return parts[parts.length - 1] || "download"
}

function isValidAbsolutePath(path: string): boolean {
  if (!path.startsWith("/")) return false
  for (const segment of path.split("/")) {
    if (segment === ".." || segment === ".") return false
  }
  return true
}

function disabledReason(status: SandboxResponse["status"]): string | null {
  switch (status) {
    case "active":
      return null
    case "idle":
      return "Start the sandbox to transfer files"
    case "pausing":
      return "Sandbox is pausing"
    case "failed":
      return "Sandbox failed — file transfer unavailable"
    case "deleted":
      return "Sandbox has been deleted"
    default:
      return "Sandbox is not running"
  }
}

interface FilesSectionProps {
  sandbox: SandboxResponse
}

export function FilesSection({ sandbox }: FilesSectionProps) {
  const reason = disabledReason(sandbox.status)
  const disabled = reason !== null

  return (
    <>
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-medium text-foreground">Files</h2>
        {reason && (
          <span className="ml-3 font-mono text-xs uppercase text-muted">
            {reason}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 border-b border-border">
        <div className="border-r border-border">
          <UploadPanel sandbox={sandbox} disabled={disabled} reason={reason} />
        </div>
        <DownloadPanel sandbox={sandbox} disabled={disabled} reason={reason} />
      </div>
    </>
  )
}

interface PanelProps {
  sandbox: SandboxResponse
  disabled: boolean
  reason: string | null
}

function MaybeTooltip({
  reason,
  children,
}: {
  reason: string | null
  children: React.ReactElement
}) {
  if (!reason) return children
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex">{children}</span>}
      />
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  )
}

function UploadPanel({ sandbox, disabled, reason }: PanelProps) {
  const { addToast } = useToast()
  const posthog = usePostHog()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [path, setPath] = useState("/home/user/")
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const resolvePath = (name: string) => {
    if (!path || path.endsWith("/")) {
      return `${path || "/home/user/"}${name}`
    }
    return path
  }

  const acceptFile = (f: File | null) => {
    if (!f) return
    setFile(f)
    if (path === "" || path.endsWith("/")) {
      setPath(`${path || "/home/user/"}${f.name}`)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0] ?? null)
  }

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    if (disabled) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    if (disabled) return
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0] ?? null
    acceptFile(f)
  }

  const canUpload = !disabled && !uploading && !!file && !!path.trim()

  const handleUpload = async () => {
    if (!file) return
    const target = resolvePath(file.name).trim()
    if (!isValidAbsolutePath(target)) {
      addToast(
        "Path must be absolute and cannot contain '..' segments",
        "error",
      )
      return
    }
    setUploading(true)
    const startedAt = performance.now()
    try {
      const res = await fetch(filesUrl(sandbox.id, target), {
        method: "POST",
        headers: { "X-Access-Token": sandbox.access_token },
        body: file,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `Upload failed (${res.status})`)
      }
      posthog.capture(FILE_EVENTS.UPLOAD_SUCCEEDED, {
        sandbox_id: sandbox.id,
        file_size: file.size,
        duration_ms: Math.round(performance.now() - startedAt),
      })
      addToast(`Uploaded to ${target}`, "success")
      setFile(null)
      if (inputRef.current) inputRef.current.value = ""
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed"
      posthog.capture(FILE_EVENTS.UPLOAD_FAILED, {
        sandbox_id: sandbox.id,
        file_size: file.size,
        error: message,
      })
      addToast(message, "error")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-4">
      <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted">
        <UploadSimpleIcon className="size-3.5" weight="light" />
        Upload
      </div>
      <label
        aria-label="Select or drag a file to upload"
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-4 py-8 text-center transition-colors ${
          disabled
            ? "pointer-events-none border-border opacity-50"
            : dragOver
              ? "border-foreground bg-foreground/5"
              : "border-border hover:border-foreground/40"
        }`}
      >
        <FileArrowUpIcon
          className={`size-6 ${dragOver ? "text-foreground" : "text-muted"}`}
          weight="light"
        />
        {file ? (
          <>
            <span className="truncate font-mono text-xs text-foreground/80">
              {file.name}
            </span>
            <span className="font-mono text-xs text-muted tabular-nums">
              {formatBytes(file.size)}
            </span>
          </>
        ) : (
          <span className="font-mono text-xs uppercase text-muted">
            {dragOver ? "Drop to attach" : "Select or drag a file"}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          disabled={disabled}
          onChange={handleFileChange}
        />
      </label>
      <Input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/home/user/file.txt"
        disabled={disabled}
        className="font-mono text-xs"
      />
      <div>
        <MaybeTooltip reason={reason}>
          <Button
            variant="outline"
            size="sm"
            disabled={!canUpload}
            onClick={handleUpload}
          >
            <UploadSimpleIcon className="size-3.5" weight="light" />
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </MaybeTooltip>
      </div>
    </div>
  )
}

function DownloadPanel({ sandbox, disabled, reason }: PanelProps) {
  const { addToast } = useToast()
  const posthog = usePostHog()
  const [path, setPath] = useState("/home/user/")
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<{
    loaded: number
    total: number | null
  } | null>(null)

  const canDownload = !disabled && !downloading && !!path.trim()

  const handleDownload = async () => {
    const target = path.trim()
    if (!isValidAbsolutePath(target) || target.endsWith("/")) {
      addToast(
        "Path must be an absolute file path without '..' segments",
        "error",
      )
      return
    }
    setDownloading(true)
    setProgress({ loaded: 0, total: null })
    const startedAt = performance.now()
    try {
      const res = await fetch(filesUrl(sandbox.id, target), {
        method: "GET",
        headers: { "X-Access-Token": sandbox.access_token },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `Download failed (${res.status})`)
      }

      const lengthHeader = res.headers.get("content-length")
      const total = lengthHeader ? Number(lengthHeader) : null
      setProgress({ loaded: 0, total })

      const reader = res.body?.getReader()
      const chunks: BlobPart[] = []
      let loaded = 0
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            loaded += value.byteLength
            setProgress({ loaded, total })
          }
        }
      } else {
        const blob = await res.blob()
        chunks.push(blob)
        loaded = blob.size
      }

      const blob = new Blob(chunks)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileNameFromPath(target)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      posthog.capture(FILE_EVENTS.DOWNLOAD_SUCCEEDED, {
        sandbox_id: sandbox.id,
        file_size: blob.size,
        duration_ms: Math.round(performance.now() - startedAt),
      })
      addToast(`Downloaded ${fileNameFromPath(target)}`, "success")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed"
      posthog.capture(FILE_EVENTS.DOWNLOAD_FAILED, {
        sandbox_id: sandbox.id,
        error: message,
      })
      addToast(message, "error")
    } finally {
      setDownloading(false)
      setProgress(null)
    }
  }

  const progressLabel = (() => {
    if (!progress) return null
    if (progress.total) {
      const pct = Math.min(
        100,
        Math.round((progress.loaded / progress.total) * 100),
      )
      return `${pct}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
    }
    return formatBytes(progress.loaded)
  })()

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-4">
      <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted">
        <DownloadSimpleIcon className="size-3.5" weight="light" />
        Download
      </div>
      <Input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/home/user/file.txt"
        disabled={disabled}
        className="font-mono text-xs"
      />
      <div className="flex items-center gap-3">
        <MaybeTooltip reason={reason}>
          <Button
            variant="outline"
            size="sm"
            disabled={!canDownload}
            onClick={handleDownload}
          >
            <DownloadSimpleIcon className="size-3.5" weight="light" />
            {downloading ? "Downloading..." : "Download"}
          </Button>
        </MaybeTooltip>
        {progressLabel && (
          <span className="font-mono text-xs text-muted tabular-nums">
            {progressLabel}
          </span>
        )}
      </div>
    </div>
  )
}
