import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"

import { Sandbox } from "@superserve/sdk"
import type { Command } from "commander"

import { apiFetch } from "../api"
import { isInteractive, readPipedInput, readSecret } from "../args"
import {
  clearCredentials,
  configDir,
  connection,
  CONSOLE_URL,
  maskKey,
  readCredentials,
  regionOf,
  USER_AGENT,
  writeCredentials,
} from "../config"
import { CliError, EXIT } from "../errors"
import {
  color,
  info,
  isJson,
  openBrowser,
  printFields,
  printJson,
  spinner,
  success,
  warn,
  withSpinner,
} from "../output"

export function register(program: Command): void {
  program
    .command("login")
    .description("Sign in from the browser, or save an existing API key")
    .option(
      "--with-key",
      "Paste an existing API key instead of signing in from the browser",
    )
    .option("--no-browser", "Print the sign-in URL instead of opening it")
    .option(
      "--no-wait",
      "Print the sign-in URL and exit; run login again to finish",
    )
    .option(
      "--base-url <url>",
      "Control-plane URL to save with the key (for non-production endpoints)",
    )
    .addHelpText(
      "after",
      `
With no key, login opens ${CONSOLE_URL}/device, where you sign in (or sign
up, starting on the Free plan) and approve this machine. The new key is saved
locally. Agents without a browser can pass --no-wait, show the URL to a person,
then run login again to pick up the key.

To save an existing key instead, pipe it into --with-key or enter it at the prompt:
  echo "$SUPERSERVE_API_KEY" | superserve login --with-key
  superserve login --with-key

SUPERSERVE_API_KEY, when set, takes precedence over the saved key.`,
    )
    .action(
      async (opts: {
        withKey?: boolean
        browser: boolean
        wait: boolean
        baseUrl?: string
      }) => {
        const baseUrl = opts.baseUrl?.trim() || undefined
        // --with-key reads to EOF; only the unflagged sniff is bounded.
        const apiKey = opts.withKey
          ? (await readSecret("API key: ")).trim()
          : await readPipedInput()
        if (apiKey) {
          await saveKey(apiKey, baseUrl)
          // An older browser login must not later replace the key just saved.
          rmSync(pendingFile(), { force: true })
          return
        }
        const login = await deviceLogin({
          openBrowser: opts.browser && isInteractive(),
          wait: opts.wait,
          baseUrl,
        })
        if (login)
          await saveKey(login.apiKey, baseUrl ?? login.baseUrl, {
            setupUntil: login.newAccount
              ? Date.now() + ACCOUNT_SETUP_MS
              : undefined,
          })
      },
    )

  program
    .command("logout")
    .description("Remove the saved API key")
    .action(() => {
      const removed = clearCredentials()
      if (isJson()) {
        printJson({ logged_out: removed })
      } else {
        info(removed ? "Logged out." : "No saved key.")
      }
      if (process.env.SUPERSERVE_API_KEY) {
        warn("SUPERSERVE_API_KEY is still set in your environment.")
      }
    })

  program
    .command("whoami")
    .alias("status")
    .description(
      "Show which API key and endpoints are in use, and check the key",
    )
    .action(async () => {
      const conn = connection()
      // A one-row list is the cheapest authenticated call; the total count
      // header doubles as a useful summary.
      const res = await withSpinner("Checking key", () =>
        apiFetch("GET", "/sandboxes", { query: { limit: "1" } }),
      )
      const total = res.headers.get("X-Total-Count") ?? undefined
      const result = {
        key: maskKey(conn.apiKey),
        source: conn.source,
        region: regionOf(conn.apiKey) ?? "default",
        api_url: conn.baseUrl,
        sandbox_host: conn.sandboxHost,
        sandboxes: total !== undefined ? Number(total) : undefined,
        valid: true,
      }
      if (isJson()) {
        printJson(result)
        return
      }
      printFields([
        ["Key", result.key],
        [
          "Source",
          conn.source === "env"
            ? "SUPERSERVE_API_KEY"
            : readCredentials()
              ? "saved credentials"
              : conn.source,
        ],
        ["Region", result.region],
        ["API", result.api_url],
        ["Sandbox host", result.sandbox_host],
        ["Sandboxes", total],
      ])
    })
}

async function saveKey(
  apiKey: string,
  baseUrl: string | undefined,
  minted?: { setupUntil?: number },
) {
  // Non-production endpoints (e.g. a local backend) issue ss_dev_ keys.
  const prefixes = baseUrl ? ["ss_live_", "ss_dev_"] : ["ss_live_"]
  if (!prefixes.some((p) => apiKey.startsWith(p))) {
    throw new CliError(
      "That doesn't look like a Superserve API key (expected ss_live_…).",
      EXIT.USAGE,
    )
  }
  // Validate typed keys so a typo never replaces a working one. A minted key
  // is saved as is: its grant is already spent, so a failed check would lose it.
  if (!minted)
    await withSpinner("Checking key", () =>
      Sandbox.list({ apiKey, baseUrl, limit: 1 }),
    )
  const path = writeCredentials({
    api_key: apiKey,
    base_url: baseUrl,
    ...(minted?.setupUntil ? { setup_until: minted.setupUntil } : {}),
  })
  if (isJson()) {
    printJson({ logged_in: true, key: maskKey(apiKey), path })
    return
  }
  success(`Logged in with ${maskKey(apiKey)}`)
  info(color.dim(`Saved to ${path}`))
  info(`Next: ${color.cyan("superserve sandbox create")}`)
  if (process.env.SUPERSERVE_API_KEY) {
    warn("SUPERSERVE_API_KEY is set and overrides the saved key.")
  }
}

// Approving restarts a code's server-side window; keep a pending login this
// much past its original expiry so a late `login` can still redeem it.
const APPROVAL_WINDOW_MS = 10 * 60_000
// How long a just-created account's first sandbox creates wait out a 402.
const ACCOUNT_SETUP_MS = 15 * 60_000

interface PendingLogin {
  /** `login --base-url`, kept so a resumed login saves the key for it too. */
  base_url?: string
  console_url: string
  device_code: string
  user_code: string
  url: string
  expires_at: number
  interval: number
}

function pendingFile(): string {
  return join(configDir(), "pending-login.json")
}

function readPendingLogin(): PendingLogin | null {
  try {
    const data = JSON.parse(readFileSync(pendingFile(), "utf8"))
    return data?.console_url === CONSOLE_URL &&
      data.expires_at + APPROVAL_WINDOW_MS > Date.now()
      ? (data as PendingLogin)
      : null
  } catch {
    return null
  }
}

const CONSOLE_TIMEOUT_MS = 30_000

async function consoleRequest(path: string, body: unknown) {
  let res: Response
  let text: string
  try {
    res = await fetch(`${CONSOLE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONSOLE_TIMEOUT_MS),
    })
    text = await res.text()
  } catch {
    throw new CliError(
      `Could not reach ${CONSOLE_URL}.`,
      EXIT.ERROR,
      "Check your connection, or save a key with `superserve login --with-key`.",
      "network",
    )
  }
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: res.status, data }
}

async function startLogin(baseUrl?: string): Promise<PendingLogin> {
  const { status, data } = await consoleRequest("/api/cli/device", {
    client_name: hostname(),
  })
  if (status !== 200 || typeof data.device_code !== "string") {
    throw new CliError(
      String(data.error_description ?? "Could not start login."),
      EXIT.ERROR,
      undefined,
      String(data.error ?? "login_failed"),
    )
  }
  const pending: PendingLogin = {
    console_url: CONSOLE_URL,
    ...(baseUrl ? { base_url: baseUrl } : {}),
    device_code: data.device_code,
    user_code: String(data.user_code),
    url: String(data.verification_uri_complete),
    expires_at: Date.now() + Number(data.expires_in) * 1000,
    interval: Number(data.interval),
  }
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  writeFileSync(pendingFile(), `${JSON.stringify(pending)}\n`, {
    mode: 0o600,
  })
  return pending
}

interface DeviceLoginResult {
  apiKey: string
  newAccount: boolean
  /** The --base-url the login was started with. */
  baseUrl?: string
}

/** One token poll: the key, "pending" or "slow_down"; throws once the login is over. */
async function pollOnce(
  pending: PendingLogin,
): Promise<DeviceLoginResult | "pending" | "slow_down"> {
  const { status, data } = await consoleRequest("/api/cli/device/token", {
    device_code: pending.device_code,
  })
  if (status === 200 && typeof data.api_key === "string") {
    rmSync(pendingFile(), { force: true })
    return {
      apiKey: data.api_key,
      newAccount: data.new_account === true,
      baseUrl: pending.base_url,
    }
  }
  const code = String(data.error ?? "")
  if (code === "slow_down") return "slow_down"
  if (code === "authorization_pending" || status === 503) return "pending"
  rmSync(pendingFile(), { force: true })
  throw new CliError(
    String(data.error_description ?? "Login failed."),
    code === "access_denied" ? EXIT.AUTH : EXIT.ERROR,
    "Run `superserve login` to try again.",
    code || "login_failed",
  )
}

/** Device authorization (RFC 8628): the minted key, or null for --no-wait. */
async function deviceLogin(opts: {
  openBrowser: boolean
  wait: boolean
  baseUrl?: string
}): Promise<DeviceLoginResult | null> {
  let pending = readPendingLogin()
  if (pending) {
    // The server decides: approval keeps a code redeemable past our own clock,
    // so an agent re-running `login --no-wait` picks up its key here.
    try {
      const first = await pollOnce(pending)
      if (typeof first === "object") return first
    } catch (err) {
      const over = err instanceof CliError && err.code === "expired_token"
      if (!over && !(err instanceof CliError && err.code === "invalid_grant"))
        throw err
      pending = null
    }
  }
  // Open the browser for a code created now, not for one an earlier run printed.
  const fresh = pending === null
  pending ??= await startLogin(opts.baseUrl)
  if (!opts.wait) {
    if (isJson()) {
      printJson({
        logged_in: false,
        url: pending.url,
        user_code: pending.user_code,
        expires_at: new Date(pending.expires_at).toISOString(),
      })
    } else {
      info(`Open ${color.cyan(pending.url)} to sign in.`)
      info(`Code: ${color.bold(pending.user_code)}`)
      info("Run `superserve login` again after approving.")
    }
    return null
  }
  // stderr stays parseable in JSON mode, but an agent still needs the URL.
  if (isJson()) {
    process.stderr.write(
      `${JSON.stringify({ login_pending: { url: pending.url, user_code: pending.user_code } })}\n`,
    )
  } else {
    info(`Open ${color.cyan(pending.url)} to sign in.`)
    info(`Code: ${color.bold(pending.user_code)}`)
  }
  if (opts.openBrowser && fresh) openBrowser(pending.url)

  let interval = pending.interval
  const waiting = spinner("Waiting for approval in the browser")
  try {
    // The server reports expiry; this bound only stops a server that never does.
    // A resumed login just polled; polling again now would be slow_down.
    if (!fresh) await sleep(interval * 1000)
    while (Date.now() < pending.expires_at + APPROVAL_WINDOW_MS) {
      const result = await pollOnce(pending)
      if (typeof result === "object") return result
      if (result === "slow_down") interval += 5
      await sleep(interval * 1000)
    }
  } finally {
    waiting.stop()
  }
  rmSync(pendingFile(), { force: true })
  throw new CliError(
    "The login code expired.",
    EXIT.AUTH,
    "Run `superserve login` to try again.",
    "expired_token",
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
