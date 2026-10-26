/**
 * Data-plane URLs for a sandbox (terminal, files, preview), keyed off the
 * region token in its public id (`sb-<region>-<uuid>`).
 *
 * Public sandbox ids carry their home cell (`sb-usw-…`), so every data-plane
 * URL can resolve the right proxy origin from the id alone — no team/region
 * prop-threading, and it works in pure modules that can't call hooks.
 *
 * The default cell (`use`, and legacy un-prefixed ids) is configurable:
 * `NEXT_PUBLIC_SANDBOX_SCHEME` (`https` or `http`, default `https`; websockets
 * follow as `wss`/`ws`), `NEXT_PUBLIC_SANDBOX_HOST` (default
 * `sandbox.superserve.ai`) and `NEXT_PUBLIC_SANDBOX_PORT` (default: none).
 * Non-default cells resolve to their own HTTPS host and ignore that override —
 * a `usw` sandbox is never reachable via the `use` proxy.
 *
 * Mirrors the SDK's region map (packages/sdk/src/config.ts). `use` stays on
 * the legacy `sandbox.superserve.ai` host until its proxy also accepts the
 * `use-sandbox` form; add it here once it does.
 */

interface SandboxOrigin {
  secure: boolean
  host: string
  port?: string
}

const REGION_SANDBOX_ORIGINS = new Map<string, SandboxOrigin>([
  ["usw", { secure: true, host: "usw-sandbox.superserve.ai" }],
])

/** The default cell's origin from configuration; throws on an invalid value. */
export function defaultSandboxOrigin(): SandboxOrigin {
  const scheme = process.env.NEXT_PUBLIC_SANDBOX_SCHEME || "https"
  if (scheme !== "https" && scheme !== "http") {
    throw new Error(
      `NEXT_PUBLIC_SANDBOX_SCHEME must be "https" or "http", got "${scheme}"`,
    )
  }
  const port = process.env.NEXT_PUBLIC_SANDBOX_PORT || undefined
  if (
    port !== undefined &&
    !(/^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65535)
  ) {
    throw new Error(
      `NEXT_PUBLIC_SANDBOX_PORT must be a TCP port number, got "${port}"`,
    )
  }
  return {
    secure: scheme === "https",
    host: process.env.NEXT_PUBLIC_SANDBOX_HOST || "sandbox.superserve.ai",
    port,
  }
}

const DEFAULT_SANDBOX_ORIGIN = defaultSandboxOrigin()

/** Region token from a public sandbox id (`sb-<region>-<uuid>`), else undefined. */
export function regionFromSandboxId(sandboxId: string): string | undefined {
  return /^sb-([a-z0-9]{1,17})-/.exec(sandboxId)?.[1]
}

/**
 * Database uuid behind a public sandbox id (`sb-<region>-<uuid>`); any other
 * id is returned unchanged. Tables key sandboxes by the bare uuid.
 */
export function sandboxUuidFromId(sandboxId: string): string {
  return (
    /^sb-[a-z0-9]{1,17}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      sandboxId,
    )?.[1] ?? sandboxId
  )
}

/**
 * Origin of a sandbox's data-plane endpoint, `<label>-<id>.<host>`, e.g.
 * `sandboxUrl(id, "boxd", "ws")` for the terminal or
 * `sandboxUrl(id, "3000", "http")` for a preview. Callers append the path.
 */
export function sandboxUrl(
  sandboxId: string,
  label: string,
  protocol: "http" | "ws",
): string {
  const region = regionFromSandboxId(sandboxId)
  const { secure, host, port } =
    (region ? REGION_SANDBOX_ORIGINS.get(region) : undefined) ??
    DEFAULT_SANDBOX_ORIGIN
  const scheme = secure ? `${protocol}s` : protocol
  return `${scheme}://${label}-${sandboxId}.${host}${port ? `:${port}` : ""}`
}
