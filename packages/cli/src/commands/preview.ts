import {
  MAX_PREVIEW_PORT,
  MIN_PREVIEW_PORT,
  previewUrl,
  RESERVED_PREVIEW_PORT,
} from "@superserve/sdk"
import { type Command, Option } from "commander"

import { apiRequest, resolveSandboxId } from "../api"
import { confirm, parseDuration, parseInteger } from "../args"
import { connection } from "../config"
import { usageError } from "../errors"
import {
  color,
  formatDate,
  info,
  isJson,
  openBrowser,
  printFields,
  printJson,
  printTable,
  success,
  warn,
} from "../output"

interface PreviewPort {
  port: number
  access: "public" | "private"
  token_version: number
}

interface PreviewPortList {
  preview_access?: "legacy_public" | "public" | "private"
  ports?: PreviewPort[]
}

interface PreviewToken {
  token: string
  port: number
  header: string
  query_param: string
  access: "private"
  preview_access: string
  token_version: number
  expires_at?: string
}

const MAX_EXPIRES = 604_800
const SIGNED_DEFAULT = "60s"

export function register(program: Command): void {
  const preview = program
    .command("preview")
    .alias("previews")
    .description("Publish sandbox ports at public or private preview URLs")

  preview
    .command("list")
    .description("Show the default access and published ports")
    .argument("<sandbox>", "Sandbox ID or name")
    .action(async (ref: string) => {
      const id = await resolveSandboxId(ref)
      const raw = await apiRequest<PreviewPortList>(
        "GET",
        `${base(id)}/preview-ports`,
      )
      // Omitted on older sandboxes, which predate per-port publication.
      const list = {
        ...raw,
        preview_access: raw.preview_access ?? "legacy_public",
      }
      if (isJson()) return printJson(list)
      printFields([["Default access", list.preview_access]])
      if (list.preview_access === "legacy_public") {
        info(color.dim("legacy_public: every listening port is reachable."))
      }
      process.stdout.write("\n")
      printTable(
        list.ports ?? [],
        [
          { header: "port", value: (p) => String(p.port) },
          { header: "access", value: (p) => p.access },
          { header: "url", value: (p) => url(id, p.port) },
        ],
        "No published ports.",
      )
    })

  preview
    .command("publish")
    .description("Publish a port and print its URL")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<port>", `Port (${MIN_PREVIEW_PORT}–${MAX_PREVIEW_PORT})`)
    .addOption(
      new Option("--private", "Require a token for this port").conflicts(
        "public",
      ),
    )
    .option("--public", "Make this port reachable without a token")
    .option("--signed", "Print a signed browser URL (private ports)")
    .option(
      "--expires <duration>",
      `Signed URL lifetime (default ${SIGNED_DEFAULT})`,
    )
    .option("--open", "Open the URL in your browser")
    .addHelpText(
      "after",
      `
Without --private/--public a new port takes the sandbox default and an
existing port keeps its mode. Signed URLs carry a token: treat them as secrets.`,
    )
    .action(async (ref: string, portArg: string, opts: PublishOpts) => {
      const port = parsePort(portArg)
      const expires = signedExpiry(opts)
      const id = await resolveSandboxId(ref)
      const access = opts.private
        ? "private"
        : opts.public
          ? "public"
          : undefined
      const published = await apiRequest<PreviewPort>(
        "POST",
        `${base(id)}/preview-ports`,
        { body: access ? { port, access } : { port } },
      )
      let shown = url(id, port)
      let signed: SignedUrl | undefined
      if (opts.signed && published.access === "public") {
        warn("Port is public; no signed URL needed.")
      } else if (opts.signed) {
        signed = await signUrl(id, port, expires)
        shown = signed.url
      }
      if (isJson()) {
        printJson({
          ...published,
          url: url(id, port),
          ...(signed && {
            signed_url: signed.url,
            expires_at: signed.expires_at,
          }),
        })
      } else {
        success(`Published port ${port} (${published.access})`)
        if (published.access === "private" && !signed) {
          info(
            color.dim(
              `Private: send a token (superserve preview token ${ref} ${port}) or use --signed.`,
            ),
          )
        }
        process.stdout.write(`${shown}\n`)
      }
      if (opts.open) openBrowser(shown)
    })

  preview
    .command("unpublish")
    .description("Unpublish a port and revoke its tokens")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<port>", "Port")
    .action(async (ref: string, portArg: string) => {
      const port = parsePort(portArg)
      const id = await resolveSandboxId(ref)
      await apiRequest("DELETE", `${base(id)}/preview-ports/${port}`)
      if (isJson()) return printJson({ port, published: false })
      success(`Unpublished port ${port}`)
    })

  preview
    .command("url")
    .description("Print a port's preview URL")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<port>", "Port")
    .option("--signed", "Mint a signed browser URL (port must be published)")
    .option(
      "--expires <duration>",
      `Signed URL lifetime (default ${SIGNED_DEFAULT})`,
    )
    .option("--open", "Open the URL in your browser")
    .action(async (ref: string, portArg: string, opts: SignOpts) => {
      const port = parsePort(portArg)
      const expires = signedExpiry(opts)
      const id = await resolveSandboxId(ref)
      const signed = opts.signed ? await signUrl(id, port, expires) : undefined
      const shown = signed?.url ?? url(id, port)
      if (isJson()) {
        printJson(
          signed
            ? { url: signed.url, expires_at: signed.expires_at }
            : { url: shown },
        )
      } else {
        process.stdout.write(`${shown}\n`)
      }
      if (opts.open) openBrowser(shown)
    })

  preview
    .command("token")
    .description("Mint a header token for a published private port")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<port>", "Port")
    .option(
      "--expires <duration>",
      "Token lifetime, up to 7d (default: valid until rotated or unpublished)",
    )
    .addHelpText(
      "after",
      `
Prints a ready-to-use header line:
  curl -H "$(superserve preview token my-box 3000)" https://3000-<id>.<sandbox-host>`,
    )
    .action(
      async (ref: string, portArg: string, opts: { expires?: string }) => {
        const port = parsePort(portArg)
        const expires = opts.expires ? parseExpires(opts.expires) : undefined
        const id = await resolveSandboxId(ref)
        const token = await apiRequest<PreviewToken>(
          "POST",
          `${base(id)}/preview-ports/${port}/token`,
          { body: expires ? { expires_in_seconds: expires } : {} },
        )
        printToken(token)
      },
    )

  preview
    .command("rotate")
    .description("Rotate a private port's token")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<port>", "Port")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (ref: string, portArg: string, opts: { yes?: boolean }) => {
      const port = parsePort(portArg)
      const id = await resolveSandboxId(ref)
      await confirm(
        `Rotate port ${port}'s token? Existing tokens, signed links and browser sessions stop working.`,
        opts.yes,
      )
      const token = await apiRequest<PreviewToken>(
        "POST",
        `${base(id)}/preview-ports/${port}/token/rotate`,
      )
      printToken(token)
    })
}

interface SignOpts {
  signed?: boolean
  expires?: string
  open?: boolean
}

interface PublishOpts extends SignOpts {
  private?: boolean
  public?: boolean
}

interface SignedUrl {
  url: string
  expires_at?: string
}

function base(id: string): string {
  return `/sandboxes/${encodeURIComponent(id)}`
}

function url(id: string, port: number): string {
  return previewUrl(id, connection().sandboxHost, port)
}

function parsePort(input: string): number {
  const port = parseInteger(input, "Port", {
    min: MIN_PREVIEW_PORT,
    max: MAX_PREVIEW_PORT,
  })
  if (port === RESERVED_PREVIEW_PORT) {
    throw usageError(`Port ${port} is reserved for the sandbox service.`)
  }
  return port
}

function parseExpires(input: string): number {
  const s = parseDuration(input, "--expires")
  if (s < 1 || s > MAX_EXPIRES) {
    throw usageError("--expires must be between 1s and 7d.")
  }
  return s
}

function signedExpiry(opts: SignOpts): number {
  if (opts.expires && !opts.signed) {
    throw usageError("--expires applies to --signed URLs.")
  }
  return parseExpires(opts.expires ?? SIGNED_DEFAULT)
}

// Same construction as the SDK's getSignedPreviewUrl.
async function signUrl(
  id: string,
  port: number,
  expires: number,
): Promise<SignedUrl> {
  const t = await apiRequest<PreviewToken>(
    "POST",
    `${base(id)}/preview-ports/${port}/token`,
    { body: { expires_in_seconds: expires } },
  )
  const u = new URL(url(id, port))
  u.searchParams.set(t.query_param, t.token)
  return { url: u.toString(), expires_at: t.expires_at }
}

function printToken(t: PreviewToken): void {
  if (isJson()) return printJson(t)
  process.stdout.write(`${t.header}: ${t.token}\n`)
  info(
    color.dim(
      t.expires_at
        ? `Expires ${formatDate(t.expires_at)} (${t.expires_at}).`
        : "Valid until the port is rotated or unpublished.",
    ),
  )
}
