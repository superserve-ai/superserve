"use client"

import { CalendarBlankIcon } from "@phosphor-icons/react"
import {
  Button,
  cn,
  Input,
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@superserve/ui"
import { useState } from "react"

interface DateRange {
  start: Date
  end: Date
}

interface DateRangeFilterProps {
  value: DateRange | null
  onChange: (range: DateRange | null) => void
}

type PresetKey = "today" | "yesterday" | "7d" | "30d"

interface Preset {
  key: PresetKey
  label: string
  getRange: () => DateRange
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

const PRESETS: Preset[] = [
  {
    key: "today",
    label: "Today",
    getRange: () => ({
      start: startOfDay(new Date()),
      end: new Date(),
    }),
  },
  {
    key: "yesterday",
    label: "Yesterday",
    getRange: () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      return {
        start: startOfDay(yesterday),
        end: endOfDay(yesterday),
      }
    },
  },
  {
    key: "7d",
    label: "7d",
    getRange: () => {
      const start = new Date()
      start.setDate(start.getDate() - 7)
      return { start: startOfDay(start), end: new Date() }
    },
  },
  {
    key: "30d",
    label: "30d",
    getRange: () => {
      const start = new Date()
      start.setDate(start.getDate() - 30)
      return { start: startOfDay(start), end: new Date() }
    },
  },
]

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function getActivePreset(value: DateRange | null): PresetKey | null {
  if (!value) return null
  for (const preset of PRESETS) {
    const range = preset.getRange()
    if (
      startOfDay(value.start).getTime() === startOfDay(range.start).getTime() &&
      startOfDay(value.end).getTime() === startOfDay(range.end).getTime()
    ) {
      return preset.key
    }
  }
  return null
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")
  const [popoverOpen, setPopoverOpen] = useState(false)

  const activePreset = getActivePreset(value)
  const isCustom = value && !activePreset

  const handlePresetClick = (preset: Preset) => {
    if (activePreset === preset.key) {
      onChange(null)
    } else {
      onChange(preset.getRange())
    }
  }

  const handleCustomApply = () => {
    if (!customStart || !customEnd) return
    onChange({
      start: startOfDay(new Date(customStart)),
      end: endOfDay(new Date(customEnd)),
    })
    setPopoverOpen(false)
  }

  const handleCustomClear = () => {
    onChange(null)
    setCustomStart("")
    setCustomEnd("")
    setPopoverOpen(false)
  }

  return (
    <div className="flex items-center gap-1">
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => handlePresetClick(preset)}
          className={cn(
            "cursor-pointer px-2 py-1 font-mono text-xs uppercase transition-colors",
            activePreset === preset.key
              ? "bg-foreground/4 text-foreground"
              : "text-muted hover:text-foreground",
          )}
        >
          {preset.label}
        </button>
      ))}

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 px-2 py-1 font-mono text-xs uppercase transition-colors",
                isCustom
                  ? "bg-foreground/4 text-foreground"
                  : "text-muted hover:text-foreground",
              )}
            />
          }
        >
          <CalendarBlankIcon className="size-3.5" weight="light" />
          {isCustom
            ? `${formatShortDate(value.start)} – ${formatShortDate(value.end)}`
            : "Custom"}
        </PopoverTrigger>
        <PopoverPopup className="w-64 space-y-3 p-4">
          <div className="space-y-2">
            <span className="block font-mono text-xs uppercase text-muted">
              Start
            </span>
            <Input
              type="date"
              aria-label="Start date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            <span className="block font-mono text-xs uppercase text-muted">
              End
            </span>
            <Input
              type="date"
              aria-label="End date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleCustomApply}
              disabled={!customStart || !customEnd}
              className="flex-1"
            >
              Apply
            </Button>
            {isCustom && (
              <Button size="sm" variant="ghost" onClick={handleCustomClear}>
                Clear
              </Button>
            )}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  )
}
