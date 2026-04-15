import { Tabs, TabsList, TabsPanel, TabsTab } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const tabsMeta: ComponentMeta = {
  slug: "tabs",
  name: "Tabs",
  description: "Tabbed content panels.",
  category: "Data Display",
  source: "components/tabs.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: (
        <Tabs defaultValue="tab-1">
          <TabsList>
            <TabsTab value="tab-1">Overview</TabsTab>
            <TabsTab value="tab-2">Settings</TabsTab>
            <TabsTab value="tab-3">Logs</TabsTab>
          </TabsList>
          <TabsPanel value="tab-1">
            <p className="text-sm text-muted p-4">
              This is the overview tab content.
            </p>
          </TabsPanel>
          <TabsPanel value="tab-2">
            <p className="text-sm text-muted p-4">
              This is the settings tab content.
            </p>
          </TabsPanel>
          <TabsPanel value="tab-3">
            <p className="text-sm text-muted p-4">
              This is the logs tab content.
            </p>
          </TabsPanel>
        </Tabs>
      ),
      code: `<Tabs defaultValue="tab-1">
  <TabsList>
    <TabsTab value="tab-1">Overview</TabsTab>
    <TabsTab value="tab-2">Settings</TabsTab>
    <TabsTab value="tab-3">Logs</TabsTab>
  </TabsList>
  <TabsPanel value="tab-1">
    <p>This is the overview tab content.</p>
  </TabsPanel>
  <TabsPanel value="tab-2">
    <p>This is the settings tab content.</p>
  </TabsPanel>
  <TabsPanel value="tab-3">
    <p>This is the logs tab content.</p>
  </TabsPanel>
</Tabs>`,
    },
  ],
}
