"use client"

import { MinusIcon, PlusIcon } from "@phosphor-icons/react"
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
  Switch,
} from "@superserve/ui"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useMemo, useState } from "react"

import { useTemplateEntitlement } from "@/hooks/use-template-entitlement"
import { useCreateTemplate } from "@/hooks/use-templates"
import { ApiError } from "@/lib/api/client"

const CURATED_IMAGES = [
  "python:3.11-slim",
  "python:3.12-slim",
  "node:20-slim",
  "node:22-slim",
  "ubuntu:24.04",
  "debian:12-slim",
] as const

// API bounds from the create-template request schema; a team's plan caps
// narrow them, and a plan that reports no cap keeps the API maximum.
const API_MAX_VCPU = 32
const API_MIN_MEMORY_MIB = 256
const API_MIN_DISK_MIB = 1024
const API_MAX_MIB = 131072
// Live growth must stay a multiple of this above the boot size.
const MEMORY_GROWTH_STEP_MIB = 128

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

function limitOf(cap: number | null | undefined, apiMax: number): number {
  return Math.min(cap ?? apiMax, apiMax)
}

// Doubling steps from the API minimum that end exactly at the limit, so a
// team's cap is always selectable even when it isn't a power of two.
function doublingSteps(min: number, limit: number): number[] {
  const steps: number[] = []
  for (let v = min; v < limit; v *= 2) steps.push(v)
  steps.push(Math.max(min, limit))
  return steps
}

function maxMemorySteps(memory: number, memoryLimit: number): number[] {
  const top = Math.min(4 * memory, memoryLimit)
  const highest =
    memory +
    Math.floor((top - memory) / MEMORY_GROWTH_STEP_MIB) * MEMORY_GROWTH_STEP_MIB
  const candidates = doublingSteps(API_MIN_MEMORY_MIB, top).filter(
    (s) => s < highest && (s - memory) % MEMORY_GROWTH_STEP_MIB === 0,
  )
  return [...new Set([...candidates, highest])].filter((s) => s > memory)
}

// The offered step closest to a pick from below, so a cap that shrinks under
// a selection lands on the largest shape still allowed.
function clampTo(value: number, steps: readonly number[]): number {
  return steps.findLast((s) => s <= value) ?? steps[0]
}

function validateName(name: string): string | null {
  if (!name) return "Name is required"
  if (name.length > 128) return "Name must be 128 characters or fewer"
  if (!NAME_RE.test(name))
    return "Use lowercase letters, numbers, and hyphens; start with a letter or number"
  return null
}

function validateImage(image: string): string | null {
  if (!image) return "Base image is required"
  return null
}

function formatMib(mib: number): string {
  return mib >= 1024 ? `${Number((mib / 1024).toFixed(2))} GB` : `${mib} MB`
}

function formatVcpu(n: number): string {
  return `${n} vCPU`
}

function limitHint(
  cap: number | null | undefined,
  limit: number,
  format: (n: number) => string,
): string {
  return cap == null
    ? `No plan limit reported · API maximum ${format(limit)}`
    : `Up to ${format(limit)} on your plan`
}

interface StepperProps {
  label: string
  hint: string
  steps: readonly number[]
  value: number
  onChange: (value: number) => void
  format: (value: number) => string
}

function Stepper({
  label,
  hint,
  steps,
  value,
  onChange,
  format,
}: StepperProps) {
  const id = useId()
  const index = steps.indexOf(value)
  const last = steps.length - 1
  const go = (i: number) => onChange(steps[Math.max(0, Math.min(last, i))])
  const iconButton =
    "flex size-9 cursor-pointer items-center justify-center text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div id={id} className="text-sm font-medium text-foreground">
            {label}
          </div>
          <div className="text-xs text-muted">{hint}</div>
        </div>
        <div className="flex shrink-0 items-center border border-control">
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            disabled={index <= 0}
            onClick={() => go(index - 1)}
            className={iconButton}
          >
            <MinusIcon className="size-3.5" weight="bold" />
          </button>
          <div
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- steps are uneven, which a number input can't express
            role="spinbutton"
            tabIndex={0}
            aria-labelledby={id}
            aria-valuenow={value}
            aria-valuemin={steps[0]}
            aria-valuemax={steps[last]}
            aria-valuetext={format(value)}
            onKeyDown={(e) => {
              const next = {
                ArrowUp: index + 1,
                ArrowRight: index + 1,
                ArrowDown: index - 1,
                ArrowLeft: index - 1,
                Home: 0,
                End: last,
              }[e.key]
              if (next === undefined) return
              e.preventDefault()
              go(next)
            }}
            className="flex h-9 w-24 items-center justify-center border-x border-control font-mono text-sm text-foreground tabular-nums focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            {format(value)}
          </div>
          <button
            type="button"
            aria-label={`Increase ${label}`}
            disabled={index >= last}
            onClick={() => go(index + 1)}
            className={iconButton}
          >
            <PlusIcon className="size-3.5" weight="bold" />
          </button>
        </div>
      </div>
      {steps.length > 1 && (
        // Mouse shortcut across the range; the spinbutton is the keyboard path.
        <div aria-hidden className="flex gap-0.5">
          {steps.map((s, i) => (
            <button
              key={s}
              type="button"
              tabIndex={-1}
              title={format(s)}
              onClick={() => onChange(s)}
              className={cn(
                "h-1.5 flex-1 cursor-pointer transition-colors",
                i <= index
                  ? "bg-foreground"
                  : "bg-border hover:bg-foreground/40",
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[10px] tracking-wider text-muted uppercase">
      {children}
    </h3>
  )
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
  const entitlement = useTemplateEntitlement()
  const templatesUnavailable = entitlement.status === "unavailable"
  const caps = entitlement.limits
  const vcpuLimit = limitOf(caps?.max_vcpu, API_MAX_VCPU)
  const memoryLimit = limitOf(caps?.max_memory_mib, API_MAX_MIB)
  const diskLimit = limitOf(caps?.max_disk_mib, API_MAX_MIB)
  const vcpuSteps = Array.from(
    { length: Math.max(1, vcpuLimit) },
    (_, i) => i + 1,
  )
  const memorySteps = doublingSteps(API_MIN_MEMORY_MIB, memoryLimit)
  const diskSteps = doublingSteps(API_MIN_DISK_MIB, diskLimit)

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const [name, setName] = useState("")
  const [imageMode, setImageMode] = useState<"curated" | "custom">("curated")
  const [curatedImage, setCuratedImage] = useState<string>(CURATED_IMAGES[1])
  const [customImage, setCustomImage] = useState("")
  const [vcpuPick, setVcpu] = useState(1)
  const [memoryPick, setMemory] = useState(1024)
  const [diskPick, setDisk] = useState(4096)
  const [growth, setGrowth] = useState(false)
  const [memoryMaxPick, setMemoryMax] = useState(2048)
  // Picks are clamped at render rather than rewritten, so a cap or boot size
  // change always shows, and submits, a shape the API accepts.
  const vcpu = clampTo(vcpuPick, vcpuSteps)
  const memory = clampTo(memoryPick, memorySteps)
  const disk = clampTo(diskPick, diskSteps)
  const memoryMaxSteps = maxMemorySteps(memory, memoryLimit)
  const canGrow = memoryMaxSteps.length > 0
  const memoryMax =
    growth && canGrow ? clampTo(memoryMaxPick, memoryMaxSteps) : null
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
    setGrowth(false)
    setMemoryMax(2048)
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
    if (entitlement.status !== "allowed") return
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
        ...(memoryMax !== null && { memory_max_mib: memoryMax }),
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
          // 429 from POST /templates can be too_many_builds (concurrent build
          // limit) or too_many_templates (team count limit). Backend message
          // already includes the cap and contact-support copy — surface it.
          setErrors({ form: err.message })
          return
        }
        setErrors({ form: err.message })
        return
      }
      setErrors({ form: "Something went wrong. Try again." })
    }
  }

  if (entitlement.status !== "allowed") {
    if (hideTrigger && !open) return null
    if (!templatesUnavailable) {
      return (
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted">
            {entitlement.status === "error"
              ? "Template limits could not be loaded."
              : "Loading template limits…"}
          </p>
          {entitlement.status === "error" && (
            <Button onClick={() => entitlement.retry()}>
              Retry template limits
            </Button>
          )}
        </div>
      )
    }
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted">
          Your plan does not include template creation.
        </p>
        <Button render={<Link href="/billing-usage/upgrade" />}>
          Upgrade to create templates
        </Button>
      </div>
    )
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

        <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 pb-4">
          <section className="space-y-4">
            <SectionTitle>Image</SectionTitle>
            <Field label="Name" required>
              <Input
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- modal opens with focus on first field
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. python-ml"
                error={
                  errors.name ??
                  (name ? (liveNameError ?? undefined) : undefined)
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
              description="Linux/amd64 image with /bin/sh, mkdir, mount, chmod, and sync."
            >
              <div className="grid grid-cols-2 gap-2">
                {CURATED_IMAGES.map((img) => {
                  const active = imageMode === "curated" && curatedImage === img
                  return (
                    <button
                      key={img}
                      type="button"
                      aria-pressed={active}
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
                  aria-pressed={imageMode === "custom"}
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
          </section>

          <section className="space-y-5 border-t border-dashed border-border pt-5">
            <div className="space-y-1">
              <SectionTitle>Resources</SectionTitle>
              <p className="text-xs text-muted">
                Every sandbox started from this template gets these resources.
              </p>
            </div>

            <Stepper
              label="vCPU"
              hint={limitHint(caps?.max_vcpu, vcpuLimit, formatVcpu)}
              steps={vcpuSteps}
              value={vcpu}
              onChange={setVcpu}
              format={formatVcpu}
            />

            <Stepper
              label="Memory"
              hint={limitHint(caps?.max_memory_mib, memoryLimit, formatMib)}
              steps={memorySteps}
              value={memory}
              onChange={setMemory}
              format={formatMib}
            />

            <div className="space-y-4 border-l border-dashed border-border pl-4">
              <Field
                label="Memory growth"
                description={
                  canGrow
                    ? `Fixed by default. Turn on to let running sandboxes grow memory past ${formatMib(memory)}.`
                    : "Boot memory is at your plan's limit, so there is no room to grow."
                }
              >
                <Switch
                  id="template-memory-growth"
                  checked={memoryMax !== null}
                  disabled={!canGrow}
                  onCheckedChange={(checked) => {
                    setGrowth(checked)
                    if (checked) setMemoryMax(2 * memory)
                  }}
                  label="Grow memory while running"
                />
              </Field>
              {memoryMax !== null && (
                <Stepper
                  label="Max memory"
                  hint={`${formatMib(memoryMaxSteps[0])} to ${formatMib(memoryMaxSteps[memoryMaxSteps.length - 1])}: up to 4× boot memory, within your plan`}
                  steps={memoryMaxSteps}
                  value={memoryMax}
                  onChange={setMemoryMax}
                  format={formatMib}
                />
              )}
            </div>

            <Stepper
              label="Disk"
              hint={limitHint(caps?.max_disk_mib, diskLimit, formatMib)}
              steps={diskSteps}
              value={disk}
              onChange={setDisk}
              format={formatMib}
            />
            <p className="text-xs text-muted">
              Make sure the disk is large enough for your base image and build
              steps.
            </p>
          </section>

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
