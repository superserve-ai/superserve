import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const dropdownMenuMeta: ComponentMeta = {
  slug: "menu",
  name: "Menu",
  description: "A menu triggered by a button click.",
  category: "Overlays",
  source: "components/menu.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: (
        <Menu>
          <MenuTrigger render={<Button variant="outline" />}>
            Open Menu
          </MenuTrigger>
          <MenuPopup>
            <MenuItem>Edit</MenuItem>
            <MenuItem>Duplicate</MenuItem>
            <MenuSeparator />
            <MenuItem>Delete</MenuItem>
          </MenuPopup>
        </Menu>
      ),
      code: `<Menu>
  <MenuTrigger render={<Button variant="outline" />}>
    Open Menu
  </MenuTrigger>
  <MenuPopup>
    <MenuItem>Edit</MenuItem>
    <MenuItem>Duplicate</MenuItem>
    <MenuSeparator />
    <MenuItem>Delete</MenuItem>
  </MenuPopup>
</Menu>`,
    },
  ],
}
