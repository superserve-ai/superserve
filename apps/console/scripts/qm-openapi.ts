#!/usr/bin/env bun
/**
 * Keeps the console's hosted-QM types tied to qm-api's contract.
 *
 * Two steps, deliberately separate:
 *
 *   vendor    Copies the `/v1/qm/*` slice of the sandbox repo's
 *             `api/openapi.yaml` (paths plus every component they reach)
 *             into `openapi/qm.openapi.yaml`, which is committed.
 *   generate  Turns that committed slice into `src/lib/api/qm.generated.ts`,
 *             which is also committed.
 *
 * Generation therefore reads only files in this repo: it needs no sibling
 * checkout and no deployed service, so it produces the same bytes anywhere.
 * Vendoring is the only step that reaches outside, and it is run by hand
 * whenever the upstream contract moves.
 *
 * Usage:
 *   bun run scripts/qm-openapi.ts vendor [--spec <path>]
 *   bun run scripts/qm-openapi.ts generate
 *   bun run scripts/qm-openapi.ts check [--spec <path>] [--allow-missing-spec]
 *
 * The upstream spec is located by `--spec`, then the `QM_OPENAPI_SPEC`
 * environment variable, then a sibling `../sandbox/api/openapi.yaml` checkout.
 *
 * `check` always verifies the generated TypeScript against the committed
 * slice. It additionally re-vendors and compares when the upstream spec is
 * reachable; `--allow-missing-spec` (or `QM_OPENAPI_ALLOW_MISSING_SPEC=1`)
 * downgrades an unreachable spec from an error to a warning.
 *
 * That switch expires on its own: once the upstream spec *is* reachable,
 * leaving it on is itself an error, so wiring CI to the real spec and
 * removing the switch is a build failure rather than a follow-up someone
 * has to remember.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import openapiTS, { astToString } from "openapi-typescript"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"

const CONSOLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const REPO_ROOT = resolve(CONSOLE_DIR, "..", "..")

const VENDORED_SPEC = resolve(CONSOLE_DIR, "openapi/qm.openapi.yaml")
const GENERATED_TYPES = resolve(CONSOLE_DIR, "src/lib/api/qm.generated.ts")

/** Only these paths are vendored; everything else in the spec is ignored. */
const PATH_PREFIX = "/v1/qm/"

/** Component buckets a path item can reach through `$ref`. */
const COMPONENT_BUCKETS = [
  "schemas",
  "parameters",
  "responses",
  "requestBodies",
  "headers",
  "examples",
] as const

type Bucket = (typeof COMPONENT_BUCKETS)[number]
type Json = Record<string, unknown>

const VENDOR_HEADER = `# Vendored slice of the sandbox repo's api/openapi.yaml — do not edit by hand.
#
# Contains only the ${PATH_PREFIX}* operations and the components they reach.
# Refresh with:  bun run --cwd apps/console qm:openapi
# Then regenerate types with the same command; CI fails if either drifts.
`

const GENERATED_HEADER = `/**
 * Generated from openapi/qm.openapi.yaml — do not edit by hand.
 * Run \`bun run --cwd apps/console qm:openapi\` to refresh.
 *
 * src/lib/api/qm.contract.ts binds the hand-written types in types.ts to
 * these, so a contract change fails typecheck instead of failing at runtime.
 */
`

// --- spec location ---------------------------------------------------------

/** Where the upstream spec lives when nothing points somewhere else. */
const DEFAULT_UPSTREAM_SPEC = "../sandbox/api/openapi.yaml"

/**
 * An explicit `--spec`/`QM_OPENAPI_SPEC` is never silently replaced by the
 * default: a path that was asked for and is not there is reported as such.
 */
function resolveUpstreamSpec(flagValue: string | undefined): {
  path: string | null
  requested: string
} {
  const requested =
    flagValue ?? process.env.QM_OPENAPI_SPEC ?? DEFAULT_UPSTREAM_SPEC
  const path = isAbsolute(requested) ? requested : resolve(REPO_ROOT, requested)
  return { path: existsSync(path) ? path : null, requested }
}

// --- subset extraction -----------------------------------------------------

function collectRefs(node: unknown, into: Map<Bucket, Set<string>>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into)
    return
  }
  if (!node || typeof node !== "object") return

  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "$ref" && typeof value === "string") {
      const match = /^#\/components\/([^/]+)\/(.+)$/.exec(value)
      if (!match) {
        throw new Error(
          `unsupported $ref (only local component refs): ${value}`,
        )
      }
      const [, bucket, name] = match
      if (!COMPONENT_BUCKETS.includes(bucket as Bucket)) {
        throw new Error(`$ref into an unhandled component bucket: ${value}`)
      }
      into.get(bucket as Bucket)?.add(name)
      continue
    }
    collectRefs(value, into)
  }
}

function collectSecuritySchemes(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSecuritySchemes(item, into)
    return
  }
  if (!node || typeof node !== "object") return

  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "security" && Array.isArray(value)) {
      for (const requirement of value) {
        if (requirement && typeof requirement === "object") {
          for (const name of Object.keys(requirement as Json)) into.add(name)
        }
      }
      continue
    }
    collectSecuritySchemes(value, into)
  }
}

function sortedEntries<T>(source: Record<string, T>, names: Iterable<string>) {
  const out: Record<string, T> = {}
  for (const name of [...names].toSorted()) {
    const value = source[name]
    if (value === undefined) {
      throw new Error(`spec references a component it does not define: ${name}`)
    }
    out[name] = value
  }
  return out
}

function extractSubset(spec: Json): Json {
  const allPaths = (spec.paths ?? {}) as Record<string, unknown>
  const qmPathNames = Object.keys(allPaths)
    .filter((path) => path.startsWith(PATH_PREFIX))
    .toSorted()
  if (qmPathNames.length === 0) {
    throw new Error(`spec defines no ${PATH_PREFIX}* paths`)
  }

  const paths: Record<string, unknown> = {}
  for (const name of qmPathNames) paths[name] = allPaths[name]

  const components = (spec.components ?? {}) as Record<
    string,
    Record<string, unknown>
  >

  // Refs can nest (a response refs a schema that refs another), so keep
  // resolving until the set stops growing.
  const wanted = new Map<Bucket, Set<string>>(
    COMPONENT_BUCKETS.map((bucket) => [bucket, new Set<string>()]),
  )
  collectRefs(paths, wanted)
  for (;;) {
    const before = [...wanted.values()].reduce((n, set) => n + set.size, 0)
    for (const bucket of COMPONENT_BUCKETS) {
      // Snapshot before walking: `collectRefs` adds to the same sets.
      const names = [...(wanted.get(bucket) ?? [])]
      for (const name of names) {
        collectRefs(components[bucket]?.[name], wanted)
      }
    }
    const after = [...wanted.values()].reduce((n, set) => n + set.size, 0)
    if (after === before) break
  }

  const schemeNames = new Set<string>()
  collectSecuritySchemes(paths, schemeNames)

  const outComponents: Record<string, unknown> = {}
  if (schemeNames.size > 0) {
    outComponents.securitySchemes = sortedEntries(
      components.securitySchemes ?? {},
      schemeNames,
    )
  }
  for (const bucket of COMPONENT_BUCKETS) {
    const names = wanted.get(bucket)
    if (!names || names.size === 0) continue
    outComponents[bucket] = sortedEntries(components[bucket] ?? {}, names)
  }

  return {
    openapi: spec.openapi,
    // Fixed on purpose: the upstream title/version describe the whole
    // Superserve API, and bumping them should not show up as QM drift.
    info: {
      title: "Superserve hosted QM API",
      version: "0.0.0",
      description: `The ${PATH_PREFIX}* slice of the Superserve API, served by qm-api.`,
    },
    paths,
    components: outComponents,
  }
}

// --- steps -----------------------------------------------------------------

function renderVendored(upstreamSpecPath: string): string {
  const spec = parseYaml(readFileSync(upstreamSpecPath, "utf8")) as Json
  const subset = extractSubset(spec)
  return VENDOR_HEADER + stringifyYaml(subset, { lineWidth: 0 })
}

async function renderGenerated(): Promise<string> {
  if (!existsSync(VENDORED_SPEC)) {
    throw new Error(
      `missing ${VENDORED_SPEC}; run \`bun run --cwd apps/console qm:openapi\` first`,
    )
  }
  const subset = parseYaml(readFileSync(VENDORED_SPEC, "utf8")) as Json
  // openapiTS accepts an already-parsed document as well as a path or URL.
  // `defaultNonNullable: false` keeps a property with a schema default
  // optional; otherwise `harness` would be required on the create body even
  // though the contract lets the caller omit it.
  const ast = await openapiTS(subset as never, { defaultNonNullable: false })
  return GENERATED_HEADER + astToString(ast)
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null
}

// --- CLI -------------------------------------------------------------------

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

function fail(message: string): never {
  console.error(`qm-openapi: ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [command = "", ...argv] = process.argv.slice(2)
  const specFlag = flagValue(argv, "--spec")
  const allowMissingSpec =
    argv.includes("--allow-missing-spec") ||
    process.env.QM_OPENAPI_ALLOW_MISSING_SPEC === "1"

  if (command === "vendor" || command === "generate") {
    if (command === "vendor") {
      const { path, requested } = resolveUpstreamSpec(specFlag)
      if (!path) {
        fail(
          `no upstream spec at ${requested}; pass --spec <path> or set QM_OPENAPI_SPEC`,
        )
      }
      write(VENDORED_SPEC, renderVendored(path))
      console.log(`qm-openapi: vendored ${PATH_PREFIX}* from ${path}`)
    }
    write(GENERATED_TYPES, await renderGenerated())
    console.log(`qm-openapi: wrote ${GENERATED_TYPES}`)
    return
  }

  if (command !== "check") {
    fail(
      `unknown command ${JSON.stringify(command)}; expected vendor|generate|check`,
    )
  }

  const problems: string[] = []

  const { path: upstream, requested } = resolveUpstreamSpec(specFlag)
  if (upstream) {
    if (allowMissingSpec) {
      problems.push(
        `the upstream spec is reachable at ${upstream}, so the allow-missing-spec escape hatch is obsolete: drop --allow-missing-spec / QM_OPENAPI_ALLOW_MISSING_SPEC (and the comment beside it in ci.yml)`,
      )
    }
    if (read(VENDORED_SPEC) !== renderVendored(upstream)) {
      problems.push(
        `openapi/qm.openapi.yaml no longer matches ${PATH_PREFIX}* in ${upstream}; run \`bun run --cwd apps/console qm:openapi\` and commit the result`,
      )
    }
  } else if (allowMissingSpec) {
    console.warn(
      `qm-openapi: no upstream spec at ${requested}; checking the committed slice only`,
    )
  } else {
    fail(
      `no upstream spec at ${requested}; pass --spec <path>, set QM_OPENAPI_SPEC, or allow it to be missing with --allow-missing-spec`,
    )
  }

  if (read(GENERATED_TYPES) !== (await renderGenerated())) {
    problems.push(
      "src/lib/api/qm.generated.ts no longer matches openapi/qm.openapi.yaml; run `bun run --cwd apps/console qm:openapi:generate` and commit the result",
    )
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`qm-openapi: ${problem}`)
    process.exit(1)
  }
  console.log("qm-openapi: committed slice and generated types are in sync")
}

await main()
