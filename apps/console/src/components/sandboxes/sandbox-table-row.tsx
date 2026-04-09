import {
  DotsThreeVerticalIcon,
  KeyIcon,
  KeyReturnIcon,
  PlayIcon,
  PlugIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  TableCell,
} from "@superserve/ui"
import type { HTMLMotionProps } from "motion/react"
import { useRouter } from "next/navigation"
import { AnimatedTableRow } from "@/components/animated-table-row"
import type { SandboxResponse } from "@/lib/api/types"
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/lib/sandbox-utils"

interface SandboxTableRowProps extends HTMLMotionProps<"tr"> {
  sandbox: SandboxResponse
  selected: boolean
  onToggle: () => void
  onConnect: () => void
  onDelete: () => void
  onPause: () => void
  onResume: () => void
}

export function SandboxTableRow({
  sandbox,
  selected,
  onToggle,
  onConnect,
  onDelete,
  onPause,
  onResume,
  className,
  ...rest
}: SandboxTableRowProps) {
  const router = useRouter()

  return (
    <AnimatedTableRow
      className={cn("cursor-pointer", className)}
      onClick={() => router.push(`/sandboxes/${sandbox.id}/`)}
      {...rest}
    >
      <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${sandbox.name}`}
        />
      </TableCell>
      <TableCell className="font-mono text-foreground/80">
        {sandbox.name}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[sandbox.status]} dot>
          {STATUS_LABEL[sandbox.status]}
        </Badge>
      </TableCell>
      <TableCell className="text-foreground/80">
        {sandbox.snapshot_id ? `${sandbox.snapshot_id.slice(0, 8)}...` : "-"}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted tabular-nums">
        {sandbox.vcpu_count}CPU | {sandbox.memory_mib}MB
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onConnect}
          >
            <PlugIcon className="size-3.5" weight="light" />
            Connect
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-20 text-xs"
            disabled={
              sandbox.status === "pausing" || sandbox.status === "failed"
            }
            onClick={() => {
              if (sandbox.status === "active") {
                onPause()
              } else if (sandbox.status === "idle") {
                onResume()
              }
            }}
          >
            {sandbox.status === "active" || sandbox.status === "pausing" ? (
              <>
                <StopIcon className="size-3" weight="light" />
                Stop
              </>
            ) : (
              <>
                <PlayIcon className="size-3" weight="light" />
                Start
              </>
            )}
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Sandbox actions"
                />
              }
            >
              <DotsThreeVerticalIcon className="size-4" weight="bold" />
            </MenuTrigger>
            <MenuPopup>
              <MenuItem onClick={onConnect}>
                <PlugIcon className="size-4" weight="light" />
                Connect
              </MenuItem>
              <MenuItem
                onClick={() =>
                  router.push(`/sandboxes/${sandbox.id}/terminal/`)
                }
              >
                <TerminalIcon className="size-4" weight="light" />
                Open Terminal
              </MenuItem>
              <MenuItem>
                <KeyIcon className="size-4" weight="light" />
                Create SSH Access
              </MenuItem>
              <MenuItem>
                <KeyReturnIcon className="size-4" weight="light" />
                Remove SSH Access
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <TrashIcon className="size-4" weight="light" />
                Delete
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </TableCell>
    </AnimatedTableRow>
  )
}
