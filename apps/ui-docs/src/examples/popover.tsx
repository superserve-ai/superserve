import { Button, Popover, PopoverPopup, PopoverTrigger } from "@superserve/ui"
import { useState } from "react"
import type { ComponentMeta } from "../registry/types"

function PopoverDemo() {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" />}>
        Open Popover
      </PopoverTrigger>
      {open && (
        <PopoverPopup>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Popover Title</p>
            <p className="text-sm text-muted">
              This is a popover with some descriptive content.
            </p>
          </div>
        </PopoverPopup>
      )}
    </Popover>
  )
}

export const popoverMeta: ComponentMeta = {
  slug: "popover",
  name: "Popover",
  description: "A floating panel anchored to a trigger.",
  category: "Overlays",
  source: "components/popover.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: <PopoverDemo />,
      code: `<Popover>
  <PopoverTrigger render={<Button variant="outline" />}>
    Open Popover
  </PopoverTrigger>
  <PopoverPopup>
    <p className="text-sm font-medium">Popover Title</p>
    <p className="text-sm text-muted">
      This is a popover with some descriptive content.
    </p>
  </PopoverPopup>
</Popover>`,
    },
  ],
}
