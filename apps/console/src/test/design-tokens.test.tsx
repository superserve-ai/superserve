import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  Button,
  Checkbox,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectTrigger,
  Textarea,
} from "@superserve/ui"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

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

function contrast(foreground: string, background: string) {
  const { rgb, alpha } = color(foreground)
  const surface = color(background).rgb
  const blended = rgb.map(
    (channel, i) => alpha * channel + (1 - alpha) * surface[i],
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
      "bg-destructive-fill text-foreground hover:bg-destructive-fill-hover focus-visible:ring-destructive/20",
    )
    expect(destructive).not.toHaveClass("bg-destructive")
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
