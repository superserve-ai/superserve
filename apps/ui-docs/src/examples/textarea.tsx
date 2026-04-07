import { Field, Textarea } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const textareaMeta: ComponentMeta = {
  slug: "textarea",
  name: "Textarea",
  description: "A multi-line text input.",
  category: "Inputs",
  source: "components/textarea.tsx",
  props: [
    {
      name: "error",
      type: "string",
      description:
        "Error message string. When set, renders the textarea in an error state.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="max-w-sm space-y-4">
          <Textarea placeholder="Type your message here" />
        </div>
      ),
      code: `<Textarea placeholder="Type your message here" />`,
    },
    {
      title: "With Label",
      preview: (
        <div className="max-w-sm space-y-4">
          <Field label="Message">
            <Textarea placeholder="Type your message here" />
          </Field>
        </div>
      ),
      code: `<Field label="Message">
  <Textarea placeholder="Type your message here" />
</Field>`,
    },
    {
      title: "With Error",
      preview: (
        <div className="max-w-sm space-y-4">
          <Field label="Bio" error="Bio must be at least 10 characters.">
            <Textarea
              placeholder="Tell us about yourself"
              error="Bio must be at least 10 characters."
            />
          </Field>
        </div>
      ),
      code: `<Field label="Bio" error="Bio must be at least 10 characters.">
  <Textarea
    placeholder="Tell us about yourself"
    error="Bio must be at least 10 characters."
  />
</Field>`,
    },
    {
      title: "Disabled",
      preview: (
        <div className="max-w-sm space-y-4">
          <Textarea placeholder="Disabled textarea" disabled />
        </div>
      ),
      code: `<Textarea placeholder="Disabled textarea" disabled />`,
    },
  ],
}
