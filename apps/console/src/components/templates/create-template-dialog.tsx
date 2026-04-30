"use client"

import {
  Button,
  cn,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
} from "@superserve/ui"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useCreateTemplate } from "@/hooks/use-templates"
import { ApiError } from "@/lib/api/client"

const CURATED_IMAGES = [
  "python:3.11",
  "python:3.12",
  "node:20-slim",
  "node:22-slim",
  "ubuntu:24.04",
  "debian:12-slim",
] as const

const MEMORY_OPTIONS = [256, 512, 1024, 2048, 4096] as const
const DISK_OPTIONS = [1024, 2048, 4096, 8192] as const
const VCPU_OPTIONS = [1, 2, 4] as const

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

function validateName(name: string): string | null {
  if (!name) return "Name is required"
  if (name.length > 128) return "Name must be 128 characters or fewer"
  if (!NAME_RE.test(name))
    return "Use lowercase letters, numbers, and hyphens; start with a letter or number"
  return null
}

function validateImage(image: string): string | null {
  if (!image) return "Base image is required"
  const lower = image.toLowerCase()
  if (lower.includes("alpine"))
    return "Alpine images are not supported. Pick a glibc-based image."
  if (lower.includes("distroless"))
    return "Distroless images are not supported."
  return null
}

function formatMemory(mib: number): string {
  return mib >= 1024 ? `${mib / 1024} GB` : `${mib} MiB`
}

interface CreateTemplateDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

export function CreateTemplateDialog({
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: CreateTemplateDialogProps = {}) {
  const router = useRouter()
  const create = useCreateTemplate()

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const [name, setName] = useState("")
  const [imageMode, setImageMode] = useState<"curated" | "custom">("curated")
  const [curatedImage, setCuratedImage] = useState<string>(CURATED_IMAGES[1])
  const [customImage, setCustomImage] = useState("")
  const [vcpu, setVcpu] = useState<number>(1)
  const [memory, setMemory] = useState<number>(1024)
  const [disk, setDisk] = useState<number>(4096)
  const [errors, setErrors] = useState<{
    name?: string
    image?: string
    form?: string
  }>({})

  const reset = () => {
    setName("")
    setImageMode("curated")
    setCuratedImage(CURATED_IMAGES[1])
    setCustomImage("")
    setVcpu(1)
    setMemory(1024)
    setDisk(4096)
    setErrors({})
  }

  // Live-computed errors so the user sees feedback as they type.
  // Only surfaced after the name field has been touched, or always when
  // the user has entered a custom image.
  const trimmedImage =
    imageMode === "curated" ? curatedImage : customImage.trim()
  const liveNameError = useMemo(() => validateName(name.trim()), [name])
  const liveImageError = useMemo(
    () => (trimmedImage ? validateImage(trimmedImage) : null),
    [trimmedImage],
  )

  const isValid = !liveNameError && !liveImageError && trimmedImage.length > 0

  const handleCreate = async () => {
    const image = trimmedImage
    const nameError = validateName(name.trim())
    const imageError = validateImage(image)
    if (nameError || imageError) {
      setErrors({
        name: nameError ?? undefined,
        image: imageError ?? undefined,
      })
      return
    }
    setErrors({})

    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        vcpu,
        memory_mib: memory,
        disk_mib: disk,
        build_spec: { from: image },
      })
      setOpen(false)
      reset()
      router.push(`/templates/${created.id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrors({ name: "A template with this name already exists." })
          return
        }
        if (err.status === 429) {
          setErrors({
            form: "Concurrent build limit reached. Wait for a build to finish, then try again.",
          })
          return
        }
        setErrors({ form: err.message })
        return
      }
      setErrors({ form: "Something went wrong. Try again." })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button />}>New template</DialogTrigger>
      )}
      <DialogPopup className="max-w-lg [&>.absolute]:hidden">
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-6 pb-4">
          <Field label="Name" required>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. python-ml"
              error={
                errors.name ?? (name ? (liveNameError ?? undefined) : undefined)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
          </Field>

          <Field
            label="Base image"
            required
            description="Linux/amd64 image with glibc. Alpine and distroless are not supported."
          >
            <div className="grid grid-cols-2 gap-2">
              {CURATED_IMAGES.map((img) => {
                const active = imageMode === "curated" && curatedImage === img
                return (
                  <button
                    key={img}
                    type="button"
                    onClick={() => {
                      setImageMode("curated")
                      setCuratedImage(img)
                    }}
                    className={cn(
                      "cursor-pointer border border-dashed px-3 py-2 text-left font-mono text-xs transition-colors",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted hover:border-foreground/50 hover:text-foreground",
                    )}
                  >
                    {img}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setImageMode("custom")}
                className={cn(
                  "col-span-2 cursor-pointer border border-dashed px-3 py-2 text-left font-mono text-xs transition-colors",
                  imageMode === "custom"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted hover:border-foreground/50 hover:text-foreground",
                )}
              >
                Custom image…
              </button>
            </div>
            {imageMode === "custom" && (
              <div className="mt-2">
                <Input
                  value={customImage}
                  onChange={(e) => setCustomImage(e.target.value)}
                  placeholder="ghcr.io/myorg/base:v1"
                  error={errors.image ?? liveImageError ?? undefined}
                />
              </div>
            )}
          </Field>

          <Field label="Memory">
            <div className="flex border border-dashed border-border">
              {MEMORY_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMemory(m)}
                  className={cn(
                    "flex-1 cursor-pointer font-mono text-xs uppercase py-2 transition-colors",
                    memory === m
                      ? "bg-foreground text-background"
                      : "text-muted hover:text-foreground",
                  )}
                  title={formatMemory(m)}
                >
                  {m >= 1024 ? `${m / 1024} GB` : `${m} MB`}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="vCPU">
              <div className="flex border border-dashed border-border">
                {VCPU_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setVcpu(n)}
                    className={cn(
                      "flex-1 cursor-pointer font-mono text-xs uppercase py-2 transition-colors",
                      vcpu === n
                        ? "bg-foreground text-background"
                        : "text-muted hover:text-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Disk">
              <div className="flex border border-dashed border-border">
                {DISK_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDisk(d)}
                    className={cn(
                      "flex-1 cursor-pointer font-mono text-xs uppercase py-2 transition-colors",
                      disk === d
                        ? "bg-foreground text-background"
                        : "text-muted hover:text-foreground",
                    )}
                    title={`${d / 1024} GB`}
                  >
                    {d / 1024} GB
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {errors.form && (
            <p className="border border-dashed border-destructive p-3 text-xs text-destructive">
              {errors.form}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!isValid || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create & build"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
