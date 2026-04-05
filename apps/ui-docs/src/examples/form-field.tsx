import { Field, Input, Textarea } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const formFieldMeta: ComponentMeta = {
  slug: "field",
  name: "Field",
  description:
    "A wrapper for form elements with label, error, and description.",
  category: "Inputs",
  source: "components/field.tsx",
  props: [
    {
      name: "label",
      type: "string",
      required: true,
      description: "Label for the form field.",
    },
    {
      name: "htmlFor",
      type: "string",
      description: "Associates the label with a form element.",
    },
    {
      name: "error",
      type: "string",
      description: "Error message displayed below the field.",
    },
    {
      name: "description",
      type: "string",
      description: "Helper text displayed below the field.",
    },
    {
      name: "required",
      type: "boolean",
      description: "Shows a required asterisk on the label.",
    },
  ],
  examples: [
    {
      title: "Required",
      preview: (
        <div className="max-w-sm space-y-4">
          <Field label="Email" htmlFor="email" required>
            <Input id="email" placeholder="you@example.com" />
          </Field>
        </div>
      ),
      code: `<Field label="Email" htmlFor="email" required>
  <Input id="email" placeholder="you@example.com" />
</Field>`,
    },
    {
      title: "With Description",
      preview: (
        <div className="max-w-sm space-y-4">
          <Field
            label="Username"
            htmlFor="username"
            description="This will be your public display name."
          >
            <Input id="username" placeholder="superserve" />
          </Field>
        </div>
      ),
      code: `<Field
  label="Username"
  htmlFor="username"
  description="This will be your public display name."
>
  <Input id="username" placeholder="superserve" />
</Field>`,
    },
    {
      title: "With Error",
      preview: (
        <div className="max-w-sm space-y-4">
          <Field
            label="Bio"
            htmlFor="bio"
            error="Bio must be at least 10 characters."
          >
            <Textarea id="bio" placeholder="Tell us about yourself" />
          </Field>
        </div>
      ),
      code: `<Field
  label="Bio"
  htmlFor="bio"
  error="Bio must be at least 10 characters."
>
  <Textarea id="bio" placeholder="Tell us about yourself" />
</Field>`,
    },
  ],
}
