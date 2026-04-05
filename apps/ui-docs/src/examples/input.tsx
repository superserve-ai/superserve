import { Field, Input, Kbd } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const inputMeta: ComponentMeta = {
  slug: "input",
  name: "Input",
  description:
    "A text input field. Use with Field for label, error, and description.",
  category: "Inputs",
  source: "components/input.tsx",
  props: [
    {
      name: "error",
      type: "boolean",
      description: "Whether the input is in an error state.",
    },
    {
      name: "suffix",
      type: "ReactNode",
      description: "Element rendered inside the input on the right.",
    },
    {
      name: "wrapperClassName",
      type: "string",
      description: "Class name for the wrapper element.",
    },
  ],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input placeholder="Enter your name" />
        </div>
      ),
      code: `<Input placeholder="Enter your name" />`,
    },
    {
      title: "With Field",
      preview: (
        <div className="max-w-sm space-y-4">
          <Field label="Email">
            <Input placeholder="you@example.com" />
          </Field>
        </div>
      ),
      code: `<Field label="Email">
  <Input placeholder="you@example.com" />
</Field>`,
    },
    {
      title: "With Description",
      preview: (
        <div className="max-w-sm space-y-4">
          <Field
            label="Username"
            description="This will be your public display name."
          >
            <Input placeholder="superserve" />
          </Field>
        </div>
      ),
      code: `<Field label="Username" description="This will be your public display name.">
  <Input placeholder="superserve" />
</Field>`,
    },
    {
      title: "With Error",
      preview: (
        <div className="max-w-sm space-y-4">
          <Field label="Email" error="Please enter a valid email address.">
            <Input placeholder="you@example.com" error />
          </Field>
        </div>
      ),
      code: `<Field label="Email" error="Please enter a valid email address.">
  <Input placeholder="you@example.com" error />
</Field>`,
    },
    {
      title: "With Suffix",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input placeholder="Search..." suffix={<Kbd>/</Kbd>} />
        </div>
      ),
      code: `<Input placeholder="Search..." suffix={<Kbd>/</Kbd>} />`,
    },
    {
      title: "Disabled",
      preview: (
        <div className="max-w-sm space-y-4">
          <Input placeholder="Disabled input" disabled />
        </div>
      ),
      code: `<Input placeholder="Disabled input" disabled />`,
    },
  ],
}
