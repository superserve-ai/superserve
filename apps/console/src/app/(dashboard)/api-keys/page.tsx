"use client"

import {
  CopyIcon,
  DotsThreeVerticalIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import {
  useApiKeys,
  useBulkRevokeApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/hooks/use-api-keys"
import { useSelection } from "@/hooks/use-selection"
import { formatDate } from "@/lib/format"
import { API_KEY_EVENTS } from "@/lib/posthog/events"

function CreateKeyDialog({
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")
  const [createdKey, setCreatedKey] = useState<{ full: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const { addToast } = useToast()
  const posthog = usePostHog()
  const createMutation = useCreateApiKey()

  const handleCreate = () => {
    if (!name.trim()) return
    posthog.capture(API_KEY_EVENTS.CREATED, { name: name.trim() })
    createMutation.mutate(name.trim(), {
      onSuccess: (data) => {
        setCreatedKey({ full: data.key })
      },
    })
  }

  const handleCopy = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.full)
    posthog.capture(API_KEY_EVENTS.COPIED)
    setCopied(true)
    addToast("API key copied to clipboard", "success")
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setOpen(false)
    setName("")
    setCreatedKey(null)
    setCopied(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button />}>
          <PlusIcon className="size-3.5" weight="light" />
          Create Key
        </DialogTrigger>
      )}
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {createdKey ? "API Key Created" : "Create API Key"}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 pt-2">
          {createdKey ? (
            <div className="space-y-4">
              <Alert variant="warning">
                Copy this key now. You won&apos;t be able to see it again.
              </Alert>

              <Field label="Your API Key">
                <div className="flex items-center gap-2">
                  <code className="flex-1 border border-border bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                    {createdKey.full}
                  </code>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={handleCopy}
                    aria-label={copied ? "Copied" : "Copy API key"}
                  >
                    <CopyIcon
                      className="size-3.5"
                      weight={copied ? "fill" : "light"}
                    />
                  </Button>
                </div>
              </Field>
            </div>
          ) : (
            <Field label="Key Name" required>
              <Input
                placeholder="e.g. Production, CI/CD, Development"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate()
                }}
              />
            </Field>
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
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Key"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

export default function ApiKeysPage() {
  const posthog = usePostHog()
  const { data: keys, isPending, error, refetch } = useApiKeys()
  const revokeMutation = useRevokeApiKey()
  const bulkRevoke = useBulkRevokeApiKeys()
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!keys) return []
    if (!search) return keys
    return keys.filter(
      (k) =>
        k.name.toLowerCase().includes(search.toLowerCase()) ||
        k.prefix.toLowerCase().includes(search.toLowerCase()),
    )
  }, [keys, search])

  const {
    selected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
    clearSelection,
  } = useSelection(filtered)

  const deleteKey = (id: string) => {
    posthog.capture(API_KEY_EVENTS.REVOKED)
    revokeMutation.mutate(id)
    clearSelection()
  }

  const deleteSelected = () => {
    posthog.capture(API_KEY_EVENTS.BULK_REVOKED, { count: selected.size })
    bulkRevoke.mutate(Array.from(selected))
    clearSelection()
  }

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="API Keys" />
        <TableSkeleton columns={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="API Keys" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  const isEmpty = !keys || keys.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="API Keys">
        <CreateKeyDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          hideTrigger={isEmpty}
        />
      </PageHeader>

      {isEmpty ? (
        <EmptyState
          icon={KeyIcon}
          title="No API Keys"
          description="Create an API key to authenticate with the Superserve SDK."
          actionLabel="Create Key"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <>
          <TableToolbar
            searchPlaceholder="Search keys..."
            searchValue={search}
            onSearchChange={setSearch}
            selectedCount={selected.size}
            onClearSelection={clearSelection}
            onDeleteSelected={deleteSelected}
          />

          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all keys"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((apiKey) => (
                  <TableRow key={apiKey.id}>
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={selected.has(apiKey.id)}
                        onCheckedChange={() => toggleOne(apiKey.id)}
                        aria-label={`Select ${apiKey.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{apiKey.name}</TableCell>
                    <TableCell className="text-muted">
                      {formatDate(new Date(apiKey.created_at))}
                    </TableCell>
                    <TableCell className="text-muted">
                      {apiKey.last_used_at
                        ? formatDate(new Date(apiKey.last_used_at))
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Key actions"
                            />
                          }
                        >
                          <DotsThreeVerticalIcon
                            className="size-4"
                            weight="bold"
                          />
                        </MenuTrigger>
                        <MenuPopup>
                          <MenuItem
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteKey(apiKey.id)}
                          >
                            <TrashIcon className="size-4" weight="light" />
                            Revoke Key
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
