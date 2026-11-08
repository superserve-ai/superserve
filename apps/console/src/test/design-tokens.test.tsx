import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  Button,
  Checkbox,
  Field,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectTrigger,
  Switch,
  Textarea,
} from "@superserve/ui"
import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { inputMeta } from "../../../ui-docs/src/examples/input"

const css = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../packages/tailwind-config/theme.css",
  ),
  "utf8",
)
const theme = css.match(/@theme\s*\{([^}]+)\}/)![1]
const tokens = Object.fromEntries(
  [...theme.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
)

function fromLinear(channel: number) {
  const srgb =
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(1, srgb))
}

// Parse the theme's hex, rgba and oklch colors into sRGB channels in [0, 1].
function color(token: string): { rgb: number[]; alpha: number } {
  const value = tokens[token]
  if (/^#[\da-f]{6}$/i.test(value)) {
    return {
      rgb: [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255),
      alpha: 1,
    }
  }
  if (value?.startsWith("rgba(")) {
    const [r, g, b, alpha] = value.slice(5, -1).split(",").map(Number)
    return { rgb: [r / 255, g / 255, b / 255], alpha }
  }
  if (value?.startsWith("oklch(")) {
    const [lightness, chroma, hue] = value.slice(6, -1).split(/\s+/).map(Number)
    const a = chroma * Math.cos((hue * Math.PI) / 180)
    const b = chroma * Math.sin((hue * Math.PI) / 180)
    // OKLCH -> OKLab -> linear sRGB -> gamma-encoded sRGB.
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
    return {
      rgb: [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ].map(fromLinear),
      alpha: 1,
    }
  }
  throw new Error(`Unsupported color for ${token}: ${value}`)
}

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string, opacity = 1) {
  const { rgb, alpha } = color(foreground)
  const effectiveAlpha = alpha * opacity
  const surface = color(background).rgb
  const blended = rgb.map(
    (channel, i) =>
      effectiveAlpha * channel + (1 - effectiveAlpha) * surface[i],
  )
  const a = luminance(blended)
  const b = luminance(surface)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const surfaces = [
  "--color-background",
  "--color-surface",
  "--color-surface-hover",
]

describe("design token contrast (WCAG 2.x)", () => {
  it.each(surfaces)("destructive text has at least 4.5:1 on %s", (surface) => {
    expect(contrast("--color-destructive", surface)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(["--color-destructive-fill", "--color-destructive-fill-hover"])(
    "foreground text has at least 4.5:1 on %s",
    (fill) => {
      expect(contrast("--color-foreground", fill)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(surfaces.slice(0, 2))(
    "control borders have at least 3:1 on %s",
    (surface) => {
      expect(contrast("--color-control", surface)).toBeGreaterThanOrEqual(3)
    },
  )

  it.each(surfaces)("muted text has at least 4.5:1 on %s", (surface) => {
    expect(contrast("--color-muted", surface)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(surfaces.slice(0, 2))(
    "text-muted/70 has at least 4.5:1 on %s",
    (surface) => {
      expect(contrast("--color-muted", surface, 0.7)).toBeGreaterThanOrEqual(
        4.5,
      )
    },
  )
})

describe("component token classes", () => {
  it("uses the dark destructive fill and the control outline", () => {
    render(
      <>
        <Button variant="destructive">Delete</Button>
        <Button variant="outline">Cancel</Button>
      </>,
    )
    const destructive = screen.getByRole("button", { name: "Delete" })
    expect(destructive).toHaveClass(
      "bg-destructive-fill text-foreground hover:bg-destructive-fill-hover focus-visible:ring-border-focus",
    )
    expect(destructive).not.toHaveClass("bg-destructive")
    expect(destructive).not.toHaveClass("focus-visible:ring-destructive/20")
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "border border-dashed border-control",
    )
  })

  it("uses control borders on resting form controls", () => {
    render(
      <>
        <Input aria-label="Name" />
        <Textarea aria-label="Description" />
        <Select>
          <SelectTrigger aria-label="Plan" />
        </Select>
        <Checkbox aria-label="Enabled" />
        <RadioGroup>
          <RadioGroupItem id="choice" value="choice" label="Choice" />
        </RadioGroup>
      </>,
    )
    for (const label of ["Name", "Description", "Plan", "Enabled"]) {
      expect(screen.getByLabelText(label)).toHaveClass("border-control")
    }
    expect(screen.getByRole("checkbox")).toHaveClass(
      "data-[checked]:border-primary data-[checked]:bg-primary",
    )
    expect(screen.getByRole("radio", { name: "Choice" })).toHaveClass(
      "border-control data-[checked]:border-primary",
    )
  })

  it("lets an input error replace the resting border and colors its message", () => {
    render(<Input aria-label="Name" error="Name is required" />)
    const input = screen.getByRole("textbox", { name: "Name" })
    expect(input).toHaveClass("border-destructive")
    expect(input).not.toHaveClass("border-control")
    expect(screen.getByText("Name is required")).toHaveClass("text-destructive")
  })
})

describe("control state regressions", () => {
  it.each(["checkbox", "radio", "switch"])(
    "styles disabled %s and its label",
    (role) => {
      render(
        <>
          {role === "checkbox" && (
            <Checkbox id="disabled-choice" disabled label="Choice" />
          )}
          {role === "radio" && (
            <RadioGroup disabled>
              <RadioGroupItem
                id="disabled-choice"
                value="choice"
                label="Choice"
              />
            </RadioGroup>
          )}
          {role === "switch" && (
            <Switch id="disabled-choice" disabled label="Choice" />
          )}
        </>,
      )
      const control = screen.getByRole(role)
      expect(control).toHaveAttribute("data-disabled")
      expect(control).toHaveClass(
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-30",
      )
      expect(control).not.toHaveClass("disabled:opacity-30")
      expect(screen.getByText("Choice")).toHaveClass(
        "peer-data-[disabled]:cursor-not-allowed peer-data-[disabled]:opacity-30",
      )
    },
  )

  it.each(["Input", "Textarea"])("connects %s to Field errors", (kind) => {
    render(
      <Field label="Bio" error="Too short">
        {kind === "Input" ? <Input /> : <Textarea />}
      </Field>,
    )
    const control = screen.getByRole("textbox", { name: "Bio" })
    expect(control).toHaveAttribute("data-invalid")
    expect(control).toHaveAttribute("aria-invalid", "true")
    expect(control).toHaveClass("data-[invalid]:border-destructive")
    expect(control).not.toHaveClass("focus:ring-destructive/20")
    expect(control).toHaveAccessibleDescription("Too short")
  })

  it("keeps standalone Textarea controlled changes and native props", () => {
    function Standalone() {
      const [value, setValue] = useState("Initial")
      return (
        <>
          <Textarea
            aria-label="Notes"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            name="notes"
            required
            rows={5}
          />
          <output>{value}</output>
        </>
      )
    }
    const { rerender } = render(<Standalone />)
    const control = screen.getByRole("textbox", { name: "Notes" })
    fireEvent.change(control, { target: { value: "Updated" } })
    expect(control).toHaveValue("Updated")
    expect(screen.getByRole("status")).toHaveTextContent("Updated")
    expect(control).toHaveAttribute("name", "notes")
    expect(control).toHaveAttribute("rows", "5")
    expect(control).toBeRequired()
    rerender(<Textarea aria-label="Notes" defaultValue="Default" disabled />)
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(
      "Default",
    )
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeDisabled()
  })

  it("keeps a Field label on a Textarea with its own id", () => {
    render(
      <Field label="Notes">
        <Textarea id="notes" disabled />
      </Field>,
    )
    const control = screen.getByRole("textbox", { name: "Notes" })
    expect(control).toHaveAttribute("id", "notes")
    expect(control).toBeDisabled()
  })

  it("renders the input docs error exactly once in preview and code", () => {
    const example = inputMeta.examples.find(
      (example) => example.title === "With Error",
    )!
    render(example.preview)
    expect(
      screen.getAllByText("Please enter a valid email address."),
    ).toHaveLength(1)
    expect(
      example.code.split("Please enter a valid email address."),
    ).toHaveLength(2)
    expect(screen.getByRole("textbox")).toHaveClass(
      "data-[invalid]:border-destructive",
    )
  })
})

const consoleControls = [
  ["components/templates/build-log-viewer.tsx", 1, 0],
  ["components/sidebar/sidebar.tsx", 1, 0],
  ["components/sandboxes/terminal.tsx", 2, 1],
  ["components/sandboxes/terminal-tabs.tsx", 0, 1],
  ["app/(dashboard)/admin/admin-teams-table.tsx", 1, 0],
  ["app/admin/yc/page.tsx", 2, 0],
  ["app/admin/yc/decision-form.tsx", 2, 0],
  ["app/yc/claim/review-form.tsx", 1, 0],
  ["app/yc/renewal/renewal-form.tsx", 2, 0],
  ["app/yc/claim/page.tsx", 4, 1],
] as const

describe("console control borders and focus", () => {
  it.each(consoleControls)(
    "uses accessible control classes in %s",
    (path, buttons, inputs) => {
      const source = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "..", path),
        "utf8",
      )
      const classes = source
        .split('className="')
        .slice(1)
        .map((part) => part.split('"')[0])
      const controls = classes.filter((value) =>
        value.split(" ").includes("border-control"),
      )
      const existing =
        path === "app/admin/yc/decision-form.tsx"
          ? 7
          : path === "app/yc/claim/review-form.tsx"
            ? 2
            : 0
      expect(controls).toHaveLength(buttons + inputs + existing)
      expect(
        controls.filter((value) =>
          value.includes(
            "focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none",
          ),
        ),
      ).toHaveLength(buttons)
      expect(
        controls.filter((value) =>
          value.includes(
            "focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
          ),
        ),
      ).toHaveLength(inputs)
      for (const control of controls)
        expect(control.split(" ")).not.toContain("rounded")
      expect(source).not.toContain("border-foreground/30")
      expect(source).not.toContain(
        "border border-dashed border-border px-4 py-2",
      )
      expect(source).not.toContain('className="rounded border px-4 py-2')
      expect(source).not.toContain('className="mt-3 rounded border px-4 py-2')
      expect(source).not.toContain("mt-2 block w-full rounded border p-2")
    },
  )
})
