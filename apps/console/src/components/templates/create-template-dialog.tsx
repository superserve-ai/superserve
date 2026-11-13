"use client"

import {
  CaretDownIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  MinusIcon,
  PlusIcon,
  QuestionIcon,
} from "@phosphor-icons/react"
import {
  Button,
  cn,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Field,
  HighlightedCode,
  Input,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@superserve/ui"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useMemo, useRef, useState } from "react"

import { useTemplateEntitlement } from "@/hooks/use-template-entitlement"
import { useCreateTemplate } from "@/hooks/use-templates"
import { ApiError } from "@/lib/api/client"

import {
  cliCommand,
  createRequest,
  pythonSnippet,
  type TemplateShape,
  typescriptSnippet,
} from "./template-code"

const CURATED_IMAGES = [
  "python:3.12-slim",
  "python:3.11-slim",
  "node:22-slim",
  "node:20-slim",
  "ubuntu:24.04",
  "debian:12-slim",
] as const
const DEFAULT_IMAGE = CURATED_IMAGES[0]

// API bounds from the create-template request schema; a team's plan caps
// narrow them, and a plan that reports no cap keeps the API maximum.
const API_MAX_VCPU = 32
const API_MIN_MEMORY_MIB = 256
const API_MIN_DISK_MIB = 1024
const API_MAX_MIB = 131072
// Live growth must stay a multiple of this above the boot size.
const MEMORY_GROWTH_STEP_MIB = 128

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

const LIVE_MEMORY_DOCS_URL =
  "https://docs.superserve.ai/sandbox/live-memory-resizing"

const focusRing =
  "focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"

function limitOf(cap: number | null | undefined, apiMax: number): number {
  return Math.min(cap ?? apiMax, apiMax)
}

// Doubling steps from the API minimum that end exactly at the limit, so a
// team's cap is always selectable even when it isn't a power of two. A
// current pick still inside the range is kept, so a raised cap doesn't move it.
function doublingSteps(min: number, limit: number, keep?: number): number[] {
  const steps: number[] = []
  for (let v = min; v < limit; v *= 2) steps.push(v)
  steps.push(Math.max(min, limit))
  if (keep !== undefined && keep > min && keep < limit) steps.push(keep)
  return [...new Set(steps)].toSorted((a, b) => a - b)
}

function maxMemorySteps(
  memory: number,
  memoryLimit: number,
  keep: number,
): number[] {
  const top = Math.min(4 * memory, memoryLimit)
  const highest =
    memory +
    Math.floor((top - memory) / MEMORY_GROWTH_STEP_MIB) * MEMORY_GROWTH_STEP_MIB
  const candidates = doublingSteps(API_MIN_MEMORY_MIB, top).filter(
    (s) => s < highest && (s - memory) % MEMORY_GROWTH_STEP_MIB === 0,
  )
  return [...new Set([...candidates, keep, highest])]
    .filter(
      (s) =>
        s > memory &&
        s <= highest &&
        (s - memory) % MEMORY_GROWTH_STEP_MIB === 0,
    )
    .toSorted((a, b) => a - b)
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

interface StepperProps {
  label: string
  labelledBy: string
  steps: readonly number[]
  value: number
  onChange: (value: number) => void
  format: (value: number) => string
}

function Stepper({
  label,
  labelledBy,
  steps,
  value,
  onChange,
  format,
}: StepperProps) {
  const index = steps.indexOf(value)
  const last = steps.length - 1
  const go = (i: number) => onChange(steps[Math.max(0, Math.min(last, i))])
  const iconButton = cn(
    "flex size-9 cursor-pointer items-center justify-center text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30",
    focusRing,
  )
  return (
    <div className="flex shrink-0 items-center border border-dashed border-control">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={index <= 0}
        onClick={() => go(index - 1)}
        className={iconButton}
      >
        <MinusIcon className="size-3.5" weight="light" />
      </button>
      <div
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- steps are uneven, which a number input can't express
        role="spinbutton"
        tabIndex={0}
        aria-labelledby={labelledBy}
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
        className={cn(
          "flex h-9 w-24 items-center justify-center border-x border-dashed border-control font-mono text-sm text-foreground tabular-nums",
          focusRing,
        )}
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
        <PlusIcon className="size-3.5" weight="light" />
      </button>
    </div>
  )
}

// Label | control | plan max. On a phone the plan max moves under the label.
const ROW_GRID =
  "grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[1fr_auto_4.5rem]"

function PlanMax({
  cap,
  text,
  phone,
}: {
  cap: number | null | undefined
  text: string
  phone?: boolean
}) {
  const unreported = cap == null
  return (
    <span
      className={cn(
        "font-mono text-xs text-muted tabular-nums",
        phone ? "block sm:hidden" : "hidden text-right sm:block",
      )}
    >
      {phone && "max "}
      {text}
      {unreported && (
        <>
          <span aria-hidden>*</span>
          <span className="sr-only"> (API maximum)</span>
        </>
      )}
    </span>
  )
}

function ResourceRow({
  label,
  cap,
  limitText,
  children,
  labelId,
}: {
  label: string
  cap: number | null | undefined
  limitText: string
  labelId: string
  children: React.ReactNode
}) {
  return (
    <div className={ROW_GRID}>
      <div className="min-w-0">
        <span id={labelId} className="text-sm text-foreground">
          {label}
        </span>
        <PlanMax cap={cap} text={limitText} phone />
      </div>
      {children}
      <PlanMax cap={cap} text={limitText} />
    </div>
  )
}

interface GrowthChoiceProps {
  growing: boolean
  canGrow: boolean
  upTo: number
  onChange: (grow: boolean) => void
}

// Fixed vs live memory resizing, as native radios styled like the console's
// segmented buttons: arrow keys move between them and the group has a name.
function GrowthChoice({ growing, canGrow, upTo, onChange }: GrowthChoiceProps) {
  const id = useId()
  const labelId = `${id}-label`
  const hintId = `${id}-hint`
  const segment = (selected: boolean) =>
    cn(
      "flex h-8 flex-1 cursor-pointer items-center justify-center px-2 font-mono text-xs whitespace-nowrap uppercase tabular-nums transition-colors",
      "has-[:focus-visible]:relative has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-border-focus",
      "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-30",
      selected
        ? "bg-foreground text-background"
        : "text-muted hover:text-foreground",
    )
  const options = [
    { grow: false, text: "Fixed" },
    { grow: true, text: canGrow ? `Up to ${formatMib(upTo)}` : "At limit" },
  ]
  return (
    <>
      <div className={ROW_GRID}>
        <div className="flex items-center gap-1.5 border-l border-dashed border-control pl-3">
          <span id={labelId} className="text-sm text-foreground">
            Auto resize
          </span>
          <a
            href={LIVE_MEMORY_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Live memory resizing docs (opens in a new tab)"
            className={cn(
              "text-muted transition-colors hover:text-foreground",
              focusRing,
            )}
          >
            <QuestionIcon className="size-3.5" weight="light" />
          </a>
        </div>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={canGrow ? undefined : hintId}
          className="flex w-[10.5rem] divide-x divide-dashed divide-control border border-dashed border-control"
        >
          {options.map((o) => (
            <label key={o.text} className={segment(growing === o.grow)}>
              <input
                type="radio"
                name={id}
                className="sr-only"
                checked={growing === o.grow}
                disabled={o.grow && !canGrow}
                onChange={() => onChange(o.grow)}
              />
              {o.text}
            </label>
          ))}
        </div>
        <span className="hidden sm:block" />
      </div>
      {!canGrow && (
        <p id={hintId} className="mt-1.5 pl-3 text-xs text-muted">
          Boot memory is at your plan&apos;s limit, so there is no room to grow.
        </p>
      )}
    </>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          // Clipboard blocked; the snippet stays selectable.
        }
      }}
      className={cn(
        "flex size-7 cursor-pointer items-center justify-center text-muted transition-colors hover:text-foreground",
        focusRing,
      )}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-success" weight="light" />
      ) : (
        <CopyIcon className="size-3.5" weight="light" />
      )}
    </button>
  )
}

function TemplateCode({
  shape,
  open,
  onOpenChange,
}: {
  shape: TemplateShape
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const sectionId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const snippets = [
    { value: "cli", label: "CLI", lang: "bash", code: cliCommand(shape) },
    {
      value: "ts",
      label: "TypeScript",
      lang: "typescript",
      code: typescriptSnippet(shape),
    },
    {
      value: "py",
      label: "Python",
      lang: "python",
      code: pythonSnippet(shape),
    },
  ] as const
  return (
    <div className="border-t border-dashed border-border pt-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={sectionId}
        onClick={() => {
          onOpenChange(!open)
          // Jump, not scroll smoothly, so reduced-motion users see no motion.
          if (!open)
            requestAnimationFrame(() =>
              sectionRef.current?.scrollIntoView?.({ block: "nearest" }),
            )
        }}
        className="group -ml-3 text-muted"
      >
        <CodeIcon className="size-3.5" weight="light" />
        View as code
        <CaretDownIcon
          className="size-3.5 group-aria-expanded:rotate-180"
          weight="light"
        />
      </Button>
      <section
        ref={sectionRef}
        id={sectionId}
        aria-label="This template as code"
        hidden={!open}
        className="mt-2 pb-2"
      >
        <Tabs defaultValue="cli">
          <TabsList>
            {snippets.map((s) => (
              <TabsTab
                key={s.value}
                value={s.value}
                // data-active: the kit's selected style keys off an attribute
                // this Base UI version no longer sets.
                className="px-3 py-1.5 font-mono text-xs uppercase data-[active]:border-primary data-[active]:text-primary"
              >
                {s.label}
              </TabsTab>
            ))}
          </TabsList>
          {snippets.map((s) => (
            <TabsPanel key={s.value} value={s.value} className="mt-3">
              <div className="relative border border-dashed border-border bg-background">
                <div className="absolute top-1 right-1">
                  <CopyButton text={s.code} label={`Copy ${s.label} code`} />
                </div>
                <div className="p-3 pr-9 [&_code]:text-xs [&_pre]:text-xs [&_pre]:[overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap">
                  <HighlightedCode code={s.code} lang={s.lang} />
                </div>
              </div>
            </TabsPanel>
          ))}
        </Tabs>
        <p className="mt-2 font-mono text-xs text-muted">
          pull → boot → snapshot → resume · add build steps with{" "}
          <code className="text-foreground">--run</code> or{" "}
          <code className="text-foreground">steps</code>
        </p>
      </section>
    </div>
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
  const ids = useId()

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const [name, setName] = useState("")
  const [image, setImage] = useState<string>(DEFAULT_IMAGE)
  const [vcpuPick, setVcpu] = useState(1)
  const [memoryPick, setMemory] = useState(1024)
  const [diskPick, setDisk] = useState(4096)
  const [growth, setGrowth] = useState(false)
  const [memoryMaxPick, setMemoryMax] = useState(2048)
  const [codeOpen, setCodeOpen] = useState(false)
  // Picks are clamped at render rather than rewritten, so a cap or boot size
  // change always shows, and submits, a shape the API accepts.
  const memorySteps = doublingSteps(API_MIN_MEMORY_MIB, memoryLimit, memoryPick)
  const diskSteps = doublingSteps(API_MIN_DISK_MIB, diskLimit, diskPick)
  const vcpu = clampTo(vcpuPick, vcpuSteps)
  const memory = clampTo(memoryPick, memorySteps)
  const disk = clampTo(diskPick, diskSteps)
  const memoryMaxSteps = maxMemorySteps(memory, memoryLimit, memoryMaxPick)
  const canGrow = memoryMaxSteps.length > 0
  // min(4x boot, plan max), on the 128 MiB grid the API accepts.
  const growthCeiling = canGrow ? memoryMaxSteps[memoryMaxSteps.length - 1] : 0
  // Drop the opt-in once there is no room to grow, so a later lower boot size
  // doesn't re-enable it unasked.
  if (growth && !canGrow) setGrowth(false)
  const memoryMax =
    growth && canGrow ? clampTo(memoryMaxPick, memoryMaxSteps) : null
  const [errors, setErrors] = useState<{
    name?: string
    image?: string
    form?: string
  }>({})

  const reset = () => {
    setName("")
    setImage(DEFAULT_IMAGE)
    setVcpu(1)
    setMemory(1024)
    setDisk(4096)
    setGrowth(false)
    setMemoryMax(2048)
    setCodeOpen(false)
    setErrors({})
  }

  const trimmedName = name.trim()
  const trimmedImage = image.trim()
  const liveNameError = useMemo(() => validateName(trimmedName), [trimmedName])
  const liveImageError = useMemo(
    () => validateImage(trimmedImage),
    [trimmedImage],
  )

  const isValid = !liveNameError && !liveImageError

  const shape: TemplateShape = {
    name: trimmedName,
    from: trimmedImage,
    vcpu,
    memoryMib: memory,
    memoryMaxMib: memoryMax,
    diskMib: disk,
  }

  const handleCreate = async () => {
    if (entitlement.status !== "allowed") return
    const nameError = validateName(trimmedName)
    const imageError = validateImage(trimmedImage)
    if (nameError || imageError) {
      setErrors({
        name: nameError ?? undefined,
        image: imageError ?? undefined,
      })
      return
    }
    setErrors({})

    try {
      const created = await create.mutateAsync(createRequest(shape))
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

  const anyUnreported =
    caps?.max_vcpu == null ||
    caps?.max_memory_mib == null ||
    caps?.max_disk_mib == null
  const summary = [
    formatVcpu(vcpu),
    memoryMax === null
      ? formatMib(memory)
      : `${formatMib(memory)}→${formatMib(memoryMax)}`,
    `${formatMib(disk)} disk`,
  ].join(" · ")

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
      <DialogPopup className="max-w-xl [&>.absolute]:hidden">
        <DialogHeader className="pb-3">
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>
            We build the image once and snapshot it. Every sandbox from this
            template boots from that snapshot.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 pb-2">
          <Field
            label="Name"
            required
            description="Lowercase letters, numbers, and hyphens. Unique in your team."
          >
            <Input
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- modal opens with focus on first field
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. python-ml"
              spellCheck={false}
              className="font-mono"
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
            description="Any linux/amd64 OCI image with /bin/sh, mkdir, mount, chmod, and sync."
          >
            <Input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="ghcr.io/example/base:v1"
              spellCheck={false}
              className="font-mono"
              error={errors.image ?? liveImageError ?? undefined}
            />
            <fieldset
              aria-label="Common images"
              className="flex flex-wrap gap-1.5"
            >
              {CURATED_IMAGES.map((img) => {
                const active = trimmedImage === img
                return (
                  <button
                    key={img}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setImage(img)}
                    className={cn(
                      "h-7 cursor-pointer border border-dashed px-2 font-mono text-xs transition-colors",
                      focusRing,
                      active
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-control text-muted hover:text-foreground",
                    )}
                  >
                    {img}
                  </button>
                )
              })}
            </fieldset>
          </Field>

          <section aria-labelledby={`${ids}-resources`}>
            <div
              className={cn(
                ROW_GRID,
                "border-b border-dashed border-border pb-2 font-mono text-xs tracking-wider text-muted uppercase",
              )}
            >
              <h3 id={`${ids}-resources`}>Resources</h3>
              <span aria-hidden className="w-[10.5rem] text-center">
                Per sandbox
              </span>
              <span aria-hidden className="hidden text-right sm:block">
                Plan max
              </span>
            </div>
            <div className="divide-y divide-dashed divide-border">
              <div className="py-2">
                <ResourceRow
                  label="vCPU"
                  labelId={`${ids}-vcpu`}
                  cap={caps?.max_vcpu}
                  limitText={String(vcpuLimit)}
                >
                  <Stepper
                    label="vCPU"
                    labelledBy={`${ids}-vcpu`}
                    steps={vcpuSteps}
                    value={vcpu}
                    onChange={setVcpu}
                    format={formatVcpu}
                  />
                </ResourceRow>
              </div>
              <div className="space-y-1 py-2">
                <ResourceRow
                  label="Memory"
                  labelId={`${ids}-memory`}
                  cap={caps?.max_memory_mib}
                  limitText={formatMib(memoryLimit)}
                >
                  <Stepper
                    label="Memory"
                    labelledBy={`${ids}-memory`}
                    steps={memorySteps}
                    value={memory}
                    onChange={setMemory}
                    format={formatMib}
                  />
                </ResourceRow>
                <GrowthChoice
                  growing={memoryMax !== null}
                  canGrow={canGrow}
                  upTo={memoryMax ?? growthCeiling}
                  onChange={(grow) => {
                    setGrowth(grow)
                    // Start at the ceiling the option names; step down below.
                    if (grow) setMemoryMax(growthCeiling)
                  }}
                />
                {memoryMax !== null && (
                  <div className={ROW_GRID}>
                    <div className="border-l border-dashed border-control pl-3">
                      <span
                        id={`${ids}-memory-max`}
                        className="text-sm text-foreground"
                      >
                        Max memory
                      </span>
                      <span className="block font-mono text-xs text-muted sm:hidden">
                        up to {formatMib(growthCeiling)}
                      </span>
                    </div>
                    <Stepper
                      label="Max memory"
                      labelledBy={`${ids}-memory-max`}
                      steps={memoryMaxSteps}
                      value={memoryMax}
                      onChange={setMemoryMax}
                      format={formatMib}
                    />
                    <span
                      className="hidden text-right font-mono text-xs text-muted tabular-nums sm:block"
                      title="Up to 4× boot memory, within your plan"
                    >
                      {formatMib(growthCeiling)}
                    </span>
                  </div>
                )}
              </div>
              <div className="py-2">
                <ResourceRow
                  label="Disk"
                  labelId={`${ids}-disk`}
                  cap={caps?.max_disk_mib}
                  limitText={formatMib(diskLimit)}
                >
                  <Stepper
                    label="Disk"
                    labelledBy={`${ids}-disk`}
                    steps={diskSteps}
                    value={disk}
                    onChange={setDisk}
                    format={formatMib}
                  />
                </ResourceRow>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted">
              Size the disk for the image plus everything your build installs.
              {anyUnreported && (
                <>
                  {" "}
                  <span aria-hidden>*</span>No plan limit reported, so this is
                  the API maximum.
                </>
              )}
            </p>
          </section>

          <TemplateCode
            shape={shape}
            open={codeOpen}
            onOpenChange={setCodeOpen}
          />

          {errors.form && (
            <p className="border border-dashed border-destructive p-3 text-xs text-destructive">
              {errors.form}
            </p>
          )}
        </div>

        <DialogFooter className="flex-wrap items-center justify-between border-t border-dashed border-border">
          <span className="basis-full font-mono text-xs text-muted tabular-nums sm:basis-auto">
            {summary}
          </span>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!isValid || create.isPending}
            >
              {create.isPending ? "Creating…" : "Create & build"}
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
