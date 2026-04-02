"use client"

import {
  CopyIcon,
  DotsThreeVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@superserve/ui"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { TableToolbar } from "@/components/table-toolbar"

interface ApiKey {
  id: string
  name: string
  key: string
  prefix: string
  createdAt: Date
  lastUsedAt: Date | null
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function maskKey(prefix: string): string {
  return `${prefix}${"•".repeat(20)}`
}

function generateMockKey(): { full: string; prefix: string } {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let key = ""
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)]
  }
  const full = `ss_live_${key}`
  const prefix = `ss_live_${key.slice(0, 8)}...`
  return { full, prefix }
}

const INITIAL_KEYS: ApiKey[] = [
  {
    id: "1",
    name: "Production",
    key: "ss_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    prefix: "ss_live_a1b2c3d4...",
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    lastUsedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: "2",
    name: "Development",
    key: "ss_live_q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2",
    prefix: "ss_live_q7r8s9t0...",
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    lastUsedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
  {
    id: "3",
    name: "CI/CD Pipeline",
    key: "ss_live_g3h4i5j6k7l8m9n0o1p2q3r4s5t6u7v8",
    prefix: "ss_live_g3h4i5j6...",
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    lastUsedAt: null,
  },
]

function CreateKeyDialog({
  onCreated,
  open: controlledOpen,
  onOpenChange,
}: {
  onCreated: (key: ApiKey) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")
  const [createdKey, setCreatedKey] = useState<{
    full: string
    apiKey: ApiKey
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const { addToast } = useToast()

  const handleCreate = () => {
    if (!name.trim()) return
    const { full, prefix } = generateMockKey()
    const apiKey: ApiKey = {
      id: crypto.randomUUID(),
      name: name.trim(),
      key: full,
      prefix,
      createdAt: new Date(),
      lastUsedAt: null,
    }
    setCreatedKey({ full, apiKey })
  }

  const handleCopy = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.full)
    setCopied(true)
    addToast("API key copied to clipboard", "success")
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    if (createdKey) {
      onCreated(createdKey.apiKey)
    }
    setOpen(false)
    setName("")
    setCreatedKey(null)
    setCopied(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="size-3.5" weight="light" />
          Create Key
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {createdKey ? "API Key Created" : "Create API Key"}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 pt-2">
          {createdKey ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 border border-dashed border-warning/40 bg-warning/5 px-4 py-3">
                <WarningIcon
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  weight="fill"
                />
                <p className="text-xs text-foreground/80">
                  Copy this key now. You won&apos;t be able to see it again.
                </p>
              </div>

              <FormField label="Your API Key">
                <div className="flex items-center gap-2">
                  <code className="flex-1 border border-border bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                    {createdKey.full}
                  </code>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={handleCopy}
                  >
                    <CopyIcon
                      className="size-3.5"
                      weight={copied ? "fill" : "light"}
                    />
                  </Button>
                </div>
              </FormField>
            </div>
          ) : (
            <FormField label="Key Name" required>
              <Input
                placeholder="e.g. Production, CI/CD, Development"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate()
                }}
              />
            </FormField>
          )}
        </div>

        <DialogFooter>
          {createdKey ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={!name.trim()}>
                Create Key
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>(INITIAL_KEYS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!search) return keys
    return keys.filter(
      (k) =>
        k.name.toLowerCase().includes(search.toLowerCase()) ||
        k.prefix.toLowerCase().includes(search.toLowerCase()),
    )
  }, [keys, search])

  const allSelected = filtered.length > 0 && selected.size === filtered.length
  const someSelected = selected.size > 0 && !allSelected

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((k) => k.id)))
    }
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const deleteKey = (id: string) => {
    setKeys((prev) => prev.filter((k) => k.id !== id))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const deleteSelected = () => {
    setKeys((prev) => prev.filter((k) => !selected.has(k.id)))
    setSelected(new Set())
  }

  const isEmpty = keys.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between h-14 border-b border-border px-6">
        <h1 className="text-lg font-medium tracking-tight text-foreground">
          API Keys
        </h1>
        {!isEmpty && (
          <CreateKeyDialog
            onCreated={(key) => setKeys((prev) => [key, ...prev])}
          />
        )}
      </div>

      {isEmpty ? (
        <>
          <EmptyState
            icon={KeyIcon}
            title="No API Keys"
            description="Create an API key to authenticate with the Superserve SDK."
            actionLabel="Create Key"
            onAction={() => setCreateOpen(true)}
          />
          <CreateKeyDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={(key) => setKeys((prev) => [key, ...prev])}
          />
        </>
      ) : (
      <>
      <TableToolbar
        searchPlaceholder="Search keys..."
        searchValue={search}
        onSearchChange={setSearch}
        selectedCount={selected.size}
        onClearSelection={() => setSelected(new Set())}
        onDeleteSelected={deleteSelected}
      />

      <div className="flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pr-0">
                <Checkbox
                  checked={someSelected ? "indeterminate" : allSelected}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="w-[20%]">Name</TableHead>
              <TableHead className="w-[35%]">Key</TableHead>
              <TableHead className="w-[15%]">Created</TableHead>
              <TableHead className="w-[15%]">Last Used</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((apiKey) => (
              <TableRow key={apiKey.id}>
                <TableCell className="pr-0">
                  <Checkbox
                    checked={selected.has(apiKey.id)}
                    onCheckedChange={() => toggleOne(apiKey.id)}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  {apiKey.name}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs text-muted">
                      {revealedKeys.has(apiKey.id)
                        ? apiKey.key
                        : maskKey(apiKey.prefix.replace("...", ""))}
                    </code>
                    <button
                      type="button"
                      onClick={() => toggleReveal(apiKey.id)}
                      className="p-1 text-muted hover:text-foreground transition-colors cursor-pointer"
                    >
                      {revealedKeys.has(apiKey.id) ? (
                        <EyeSlashIcon className="size-3.5" weight="light" />
                      ) : (
                        <EyeIcon className="size-3.5" weight="light" />
                      )}
                    </button>
                  </div>
                </TableCell>
                <TableCell className="text-muted">
                  {formatDate(apiKey.createdAt)}
                </TableCell>
                <TableCell className="text-muted">
                  {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : "Never"}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="p-1.5 text-muted hover:text-foreground transition-colors cursor-pointer"
                      >
                        <DotsThreeVerticalIcon className="size-4" weight="bold" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={async () => {
                          await navigator.clipboard.writeText(apiKey.key)
                        }}
                      >
                        <CopyIcon className="size-4" weight="light" />
                        Copy Key
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteKey(apiKey.id)}
                      >
                        <TrashIcon className="size-4" weight="light" />
                        Revoke Key
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      </>
      )}
    </div>
  )
}
