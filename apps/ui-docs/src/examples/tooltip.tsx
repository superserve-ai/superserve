import { Button, Tooltip, TooltipPopup, TooltipTrigger } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const tooltipMeta: ComponentMeta = {
  slug: "tooltip",
  name: "Tooltip",
  description: "A popup that displays information on hover.",
  category: "Feedback",
  source: "components/tooltip.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: (
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" />}>
            Hover Me
          </TooltipTrigger>
          <TooltipPopup>This is a tooltip</TooltipPopup>
        </Tooltip>
      ),
      code: `<Tooltip>
  <TooltipTrigger render={<Button variant="outline" />}>
    Hover Me
  </TooltipTrigger>
  <TooltipPopup>This is a tooltip</TooltipPopup>
</Tooltip>`,
    },
  ],
}
