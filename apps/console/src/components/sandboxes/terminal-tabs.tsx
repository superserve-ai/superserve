"use client"

import { PlusIcon, XIcon } from "@phosphor-icons/react"
import { cn, Kbd, Tooltip, TooltipPopup, TooltipTrigger } from "@superserve/ui"
import { motion } from "motion/react"
import { usePostHog } from "posthog-js/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import {
  MAX_TERMINAL_TAB_NAME_LENGTH,
  MAX_TERMINAL_TABS,
  type TerminalTab,
  useTerminalTabs,
} from "@/hooks/use-terminal-tabs"
import { TERMINAL_EVENTS } from "@/lib/posthog/events"
import { clearTerminalBuffer } from "@/lib/terminal-tabs-storage"

import { SandboxTerminal, type TerminalConnectionStatus } from "./terminal"

interface Props {
  sandboxId: string
  accessToken: string
}

export function TerminalTabs({ sandboxId, accessToken }: Props) {
  const posthog = usePostHog()
  const {
    tabs,
    activeId,
    canAddTab,
    addTab,
    closeTab,
    selectTab,
    renameTab,
    selectNext,
    selectPrev,
  } = useTerminalTabs()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<
    Record<string, TerminalConnectionStatus>
  >({})

  const handleAdd = useCallback(() => {
    const created = addTab()
    if (created) {
      posthog.capture(TERMINAL_EVENTS.TAB_OPENED, {
        sandbox_id: sandboxId,
      })
    }
  }, [addTab, posthog, sandboxId])

  const handleClose = useCallback(
    (id: string) => {
      posthog.capture(TERMINAL_EVENTS.TAB_CLOSED, {
        sandbox_id: sandboxId,
      })
      closeTab(id)
      clearTerminalBuffer(`${sandboxId}:${id}`)
      setEditingId((current) => (current === id ? null : current))
      setStatuses((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    },
    [closeTab, posthog, sandboxId],
  )

  const handleRename = useCallback(
    (id: string, name: string) => {
      renameTab(id, name)
      posthog.capture(TERMINAL_EVENTS.TAB_RENAMED, { sandbox_id: sandboxId })
    },
    [posthog, renameTab, sandboxId],
  )

  const handleStripKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight") {
        e.preventDefault()
        selectNext()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        selectPrev()
      }
    },
    [selectNext, selectPrev],
  )

  const handleStatusChange = useCallback(
    (id: string, status: TerminalConnectionStatus) => {
      setStatuses((prev) =>
        prev[id] === status ? prev : { ...prev, [id]: status },
      )
    },
    [],
  )

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="Terminal tabs"
        tabIndex={0}
        onMouseLeave={() => setHoveredId(null)}
        onKeyDown={handleStripKeyDown}
        className="flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-dashed border-border bg-background"
      >
        {tabs.map((tab) => (
          <TerminalTabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeId}
            isHovered={hoveredId === tab.id}
            isEditing={editingId === tab.id}
            status={statuses[tab.id]}
            onSelect={selectTab}
            onClose={handleClose}
            onRename={handleRename}
            onStartEdit={() => setEditingId(tab.id)}
            onCancelEdit={() => setEditingId(null)}
            onHover={setHoveredId}
          />
        ))}
        <AddTabButton onClick={handleAdd} disabled={!canAddTab} />
      </div>

      <div className="relative flex-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
          // DOM-park inactive panels with visibility:hidden so xterm keeps
          // its dimensions (no relayout on switch, no remeasure flash) but
          // the user only sees the active terminal. pointer-events:none
          // stops stray clicks reaching parked xterm instances.
          return (
            <div
              key={tab.id}
              role="tabpanel"
              id={`terminal-panel-${tab.id}`}
              aria-labelledby={`terminal-tab-${tab.id}`}
              aria-hidden={!isActive}
              className="absolute inset-0"
              style={{
                visibility: isActive ? "visible" : "hidden",
                pointerEvents: isActive ? "auto" : "none",
              }}
            >
              <SandboxTerminal
                sandboxId={sandboxId}
                accessToken={accessToken}
                isActive={isActive}
                bufferKey={`${sandboxId}:${tab.id}`}
                onStatusChange={(status) => handleStatusChange(tab.id, status)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface TerminalTabButtonProps {
  tab: TerminalTab
  isActive: boolean
  isHovered: boolean
  isEditing: boolean
  status: TerminalConnectionStatus | undefined
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onHover: (id: string | null) => void
}

function TerminalTabButton({
  tab,
  isActive,
  isHovered,
  isEditing,
  status,
  onSelect,
  onClose,
  onRename,
  onStartEdit,
  onCancelEdit,
  onHover,
}: TerminalTabButtonProps) {
  // mouseenter doesn't bubble, so we attach to both inner interactive elements
  // rather than the wrapper — keeps hover state correct when the user enters
  // via the close button and avoids a static-element interaction lint.
  const handleHover = () => onHover(tab.id)
  return (
    <div
      className={cn(
        "group relative flex h-full max-w-[200px] min-w-[120px] shrink-0 items-center border-r border-dashed border-foreground/8",
        isActive ? "text-foreground" : "text-muted hover:text-foreground",
      )}
    >
      {isHovered && !isActive && (
        <motion.span
          className="absolute inset-0 bg-foreground/4"
          layoutId="terminal-tab-hover"
          transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
        />
      )}
      {isActive && <span className="absolute inset-0 bg-foreground/6" />}
      {isActive && (
        <motion.span
          className="pointer-events-none absolute inset-0"
          layoutId="terminal-tab-active"
          transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
        >
          <CornerBrackets size="md" />
        </motion.span>
      )}

      <button
        type="button"
        role="tab"
        id={`terminal-tab-${tab.id}`}
        aria-selected={isActive}
        aria-controls={`terminal-panel-${tab.id}`}
        tabIndex={isActive ? 0 : -1}
        onClick={() => onSelect(tab.id)}
        onDoubleClick={onStartEdit}
        onMouseEnter={handleHover}
        className="relative flex h-full flex-1 cursor-pointer items-center gap-1.5 px-3 outline-none select-none"
      >
        <StatusDot status={status} />
        {isEditing ? (
          <RenameInput
            initialValue={tab.name}
            onCommit={(value) => {
              onRename(tab.id, value)
              onCancelEdit()
            }}
            onCancel={onCancelEdit}
          />
        ) : (
          <span className="truncate font-mono text-xs uppercase">
            {tab.name}
          </span>
        )}
      </button>

      {!isEditing && (
        <button
          type="button"
          aria-label={`Close ${tab.name}`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            onClose(tab.id)
          }}
          onMouseEnter={handleHover}
          className={cn(
            "relative mr-1.5 flex size-5 shrink-0 cursor-pointer items-center justify-center transition",
            "text-muted hover:bg-foreground/8 hover:text-foreground",
            isActive
              ? "opacity-60 hover:opacity-100"
              : "opacity-0 group-hover:opacity-60 group-hover:hover:opacity-100",
          )}
        >
          <XIcon className="size-2.5" weight="light" />
        </button>
      )}
    </div>
  )
}

function StatusDot({
  status,
}: {
  status: TerminalConnectionStatus | undefined
}) {
  // Connected (or unknown) is the default state — don't add visual noise.
  if (!status || status === "connected") return null

  const isConnecting = status === "connecting"
  return (
    <span
      aria-hidden="true"
      title={
        isConnecting
          ? "Connecting…"
          : status === "error"
            ? "Error"
            : "Disconnected"
      }
      className={cn(
        "size-1 shrink-0 rounded-full",
        isConnecting ? "animate-pulse bg-orange-400" : "bg-red-500",
      )}
    />
  )
}

interface RenameInputProps {
  initialValue: string
  onCommit: (value: string) => void
  onCancel: () => void
}

function RenameInput({ initialValue, onCommit, onCancel }: RenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={initialValue}
      maxLength={MAX_TERMINAL_TAB_NAME_LENGTH}
      aria-label="Rename tab"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") {
          e.preventDefault()
          const value = e.currentTarget.value.trim()
          if (value) onCommit(value)
          else onCancel()
        } else if (e.key === "Escape") {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={(e) => {
        const value = e.currentTarget.value.trim()
        if (value && value !== initialValue) onCommit(value)
        else onCancel()
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="w-full min-w-0 border border-dashed border-foreground/30 bg-surface px-1 py-0.5 font-mono text-xs text-foreground uppercase outline-none"
    />
  )
}

function AddTabButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled: boolean
}) {
  const className = cn(
    "flex h-full w-10 shrink-0 cursor-pointer items-center justify-center transition-colors",
    disabled
      ? "cursor-not-allowed text-muted/40"
      : "text-muted hover:bg-foreground/4 hover:text-foreground",
  )

  const button = (
    <button
      type="button"
      aria-label="New terminal tab"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      <PlusIcon className="size-3.5" weight="light" />
    </button>
  )

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup>
        {disabled ? (
          `Max ${MAX_TERMINAL_TABS} tabs`
        ) : (
          <span className="inline-flex items-center gap-2">
            New tab <Kbd>⌘⌃T</Kbd>
          </span>
        )}
      </TooltipPopup>
    </Tooltip>
  )
}
