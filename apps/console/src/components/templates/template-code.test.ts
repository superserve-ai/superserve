import { describe, expect, it } from "vitest"

import {
  cliCommand,
  cliSize,
  createRequest,
  pythonSnippet,
  shellQuote,
  type TemplateShape,
  typescriptSnippet,
} from "./template-code"

const fixed: TemplateShape = {
  name: "python-ml",
  from: "python:3.12-slim",
  vcpu: 2,
  memoryMib: 2048,
  memoryMaxMib: null,
  memoryShrinkAfterSeconds: null,
  diskMib: 8192,
}
const growing: TemplateShape = { ...fixed, memoryMaxMib: 8192 }

// Parses the CLI's own size syntax (packages/cli/src/commands/template.ts).
function parseMib(input: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(m|mi|mib|mb|g|gi|gib|gb)?$/i.exec(input)
  if (!m) throw new Error(`unparseable size ${input}`)
  return Number(m[1]) * (/^g/i.test(m[2] ?? "") ? 1024 : 1)
}

// Reads `--flag value` pairs back out of the generated command.
function cliFlags(command: string): Record<string, string> {
  const flags: Record<string, string> = {}
  for (const m of command.matchAll(/--([a-z-]+) (\S+)/g)) flags[m[1]] = m[2]
  return flags
}

describe("createRequest", () => {
  it("sends a fixed shape without a memory ceiling", () => {
    expect(createRequest(fixed)).toEqual({
      name: "python-ml",
      vcpu: 2,
      memory_mib: 2048,
      disk_mib: 8192,
      build_spec: { from: "python:3.12-slim" },
    })
  })

  it("adds memory_max_mib only when memory can grow", () => {
    expect(createRequest(growing)).toMatchObject({ memory_max_mib: 8192 })
  })
})

describe("cliCommand", () => {
  it("matches the request field for field", () => {
    for (const shape of [fixed, growing, { ...fixed, memoryMib: 1536 }]) {
      const body = createRequest(shape)
      const command = cliCommand(shape)
      const flags = cliFlags(command)
      expect(command.split(" \\\n")[0]).toBe(
        `superserve template create ${body.name}`,
      )
      expect(flags.from).toBe(body.build_spec.from)
      expect(Number(flags.vcpu)).toBe(body.vcpu)
      expect(parseMib(flags.memory)).toBe(body.memory_mib)
      expect(parseMib(flags.disk)).toBe(body.disk_mib)
      if (body.memory_max_mib === undefined)
        expect(flags).not.toHaveProperty("memory-max")
      else expect(parseMib(flags["memory-max"])).toBe(body.memory_max_mib)
    }
  })

  it("prints one flag per line in the CLI's own units", () => {
    expect(cliCommand(growing)).toBe(
      [
        "superserve template create python-ml \\",
        "  --from python:3.12-slim \\",
        "  --vcpu 2 \\",
        "  --memory 2G \\",
        "  --memory-max 8G \\",
        "  --disk 8G",
      ].join("\n"),
    )
  })

  it("shows placeholders, quoted for the shell, before name and image are set", () => {
    const command = cliCommand({ ...fixed, name: "", from: "" })
    expect(command).toContain("template create '<name>'")
    expect(command).toContain("--from '<image>'")
  })
})

describe("typescriptSnippet", () => {
  it("uses the SDK's Template.create options", () => {
    expect(typescriptSnippet(growing)).toBe(
      [
        'import { Template } from "@superserve/sdk"',
        "",
        "const template = await Template.create({",
        '  name: "python-ml",',
        '  from: "python:3.12-slim",',
        "  vcpu: 2,",
        "  memoryMib: 2048,",
        "  memoryMaxMib: 8192,",
        "  diskMib: 8192,",
        "})",
        "await template.waitUntilReady()",
      ].join("\n"),
    )
  })

  it("leaves memoryMaxMib out for fixed memory", () => {
    expect(typescriptSnippet(fixed)).not.toContain("memoryMaxMib")
  })
})

describe("pythonSnippet", () => {
  it("uses the SDK's Template.create keyword arguments", () => {
    expect(pythonSnippet(growing)).toBe(
      [
        "from superserve import Template",
        "",
        "template = Template.create(",
        '    name="python-ml",',
        '    from_="python:3.12-slim",',
        "    vcpu=2,",
        "    memory_mib=2048,",
        "    memory_max_mib=8192,",
        "    disk_mib=8192,",
        ")",
        "template.wait_until_ready()",
      ].join("\n"),
    )
  })

  it("leaves memory_max_mib out for fixed memory", () => {
    expect(pythonSnippet(fixed)).not.toContain("memory_max_mib")
  })
})

describe("shell and size helpers", () => {
  it.each([
    ["ghcr.io/example/base:v1", "ghcr.io/example/base:v1"],
    ["my image", "'my image'"],
    ["it's", `'it'\\''s'`],
  ])("quotes %s as %s", (input, out) => {
    expect(shellQuote(input)).toBe(out)
  })

  it.each([
    [512, "512M"],
    [1024, "1G"],
    [1536, "1536M"],
    [131072, "128G"],
  ])("prints %d MiB as %s", (mib, out) => {
    expect(cliSize(mib)).toBe(out)
    expect(parseMib(out)).toBe(mib)
  })
})
