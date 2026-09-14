// Shared helpers for the spawn hook and the monitor: sandbox tagging, the
// in-sandbox worker supervisor scripts, and the Cursor pool API.
import { Sandbox } from "@superserve/sdk"

export const META_MANAGED = "cursor.managed"
export const META_WORKER_ID = "cursor.worker_id"
export const META_POOL = "cursor.pool"
export const META_REQUEST_ID = "cursor.request_id"
export const META_REPO = "cursor.repo"
// Set by the spawn hook while it resumes and relaunches a paused sandbox, so the
// monitor leaves it alone until the new worker is up (see MONITOR_GRACE_SECONDS).
export const META_LAUNCHING = "cursor.launching"
// Set by the monitor while it pauses or deletes a sandbox; the spawn hook
// treats a fresh marker as "not mine to reuse" and starts a new sandbox.
export const META_RECYCLING = "cursor.recycling"

export const STATE_DIR = "/var/lib/cursor-worker"
const PIDFILE = `${STATE_DIR}/worker.pid`
const EXITFILE = `${STATE_DIR}/worker.exit`
const LOGFILE = `${STATE_DIR}/worker.log`

const STARTUP_GRACE_MS = 5000

function flag(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  return raw === "true" || raw === "1"
}

// Sandboxes resolve DNS through these public resolvers. A strict allowlist has
// to include them or nothing resolves. Single IPs are written as /32.
// A strict allowlist still needs the sandbox's resolvers, or nothing resolves.
// The SDK reaches the sandbox through the platform, not through its network,
// so no Superserve host needs to be allowed.
const DNS_RESOLVERS = ["1.1.1.1/32", "8.8.8.8/32"]
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

function egressAllowlist(raw) {
  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => (IPV4_RE.test(e) ? `${e}/32` : e))
  if (entries.length === 0) return []
  return [...new Set([...DNS_RESOLVERS, ...entries])]
}

export const config = {
  templateName: process.env.CURSOR_WORKER_TEMPLATE || "cursor-worker",
  idleReleaseTimeout: process.env.CURSOR_WORKER_IDLE_RELEASE_TIMEOUT || "600",
  cloneGitRepos: flag("CURSOR_WORKER_CLONE_GIT_REPOS", true),
  hibernate: flag("CURSOR_WORKER_HIBERNATE", false),
  autoDeleteSeconds: Number(process.env.SANDBOX_AUTO_DELETE_SECONDS || 86_400),
  allowOut: egressAllowlist(process.env.CURSOR_WORKER_ALLOW_OUT || ""),
  cursorEndpoint: process.env.CURSOR_API_ENDPOINT || "https://api.cursor.com",
}

const PROBE_SCRIPT = `#!/bin/bash
set +e
if test -f "${EXITFILE}"; then
  code=$(head -n1 "${EXITFILE}" 2>/dev/null | tr -d '[:space:]')
  printf '{"state":"exited","pid":null,"exit_code":%s}\\n' "\${code:-null}"
  exit 0
fi
if ! test -s "${PIDFILE}"; then
  printf '{"state":"no_pidfile","pid":null,"exit_code":null}\\n'
  exit 0
fi
pid=$(head -n1 "${PIDFILE}" 2>/dev/null | tr -d '[:space:]')
# The launcher runs the worker under setsid, so the recorded pid is also the
# process group id. The group counts as running while any member is alive,
# even if the leader has already gone.
if kill -0 "$pid" 2>/dev/null || pgrep -g "$pid" >/dev/null 2>&1; then
  printf '{"state":"running","pid":%s,"exit_code":null}\\n' "$pid"
else
  printf '{"state":"dead","pid":%s,"exit_code":null}\\n' "$pid"
fi
`

const STOP_SCRIPT = `#!/bin/bash
set +e
# Same critical section as launch.sh: a stop and a launch never interleave,
# so a launch cannot lose its fresh pid file to a concurrent stop.
exec 9>"${STATE_DIR}/launch.lock"
flock -w 30 9 || { echo "stop: could not acquire lock" >&2; exit 1; }
if test -s "${PIDFILE}"; then
  pid=$(head -n1 "${PIDFILE}" 2>/dev/null | tr -d '[:space:]')
  # pid is the process group id (see launch.sh). Stop the whole group and
  # wait for every member, not just the leader: a child that outlives the
  # wrapper must not be reported as stopped.
  if test -n "$pid"; then
    kill -TERM -- "-$pid" 2>/dev/null
    for i in $(seq 1 20); do
      pgrep -g "$pid" >/dev/null 2>&1 || break
      sleep 0.5
    done
    if pgrep -g "$pid" >/dev/null 2>&1; then
      kill -KILL -- "-$pid" 2>/dev/null
      for i in $(seq 1 10); do
        pgrep -g "$pid" >/dev/null 2>&1 || break
        sleep 0.5
      done
    fi
    if pgrep -g "$pid" >/dev/null 2>&1; then
      echo "stop: process group $pid still has live members" >&2
      exit 1
    fi
  fi
fi
rm -f "${PIDFILE}" "${EXITFILE}"
`

// The worker runs detached from the exec session (setsid) so it outlives the
// API call that started it. The command itself lives in run.sh so no shell
// quoting is involved; the exit code lands in EXITFILE for the probe.
const RUNFILE = `${STATE_DIR}/run.sh`
const LAUNCH_SCRIPT = `#!/bin/bash
set -eu
export HOME="\${HOME:-/root}"
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
mkdir -p "${STATE_DIR}" /workspace
cd /workspace
# Serialize launches: the check below and the start after it must be one
# critical section, or two launchers can both see no live pid and start two
# workers. The lock is held by this script only (the worker closes fd 9).
exec 9>"${STATE_DIR}/launch.lock"
flock -w 30 9 || { echo "launch: could not acquire lock" >&2; exit 1; }
# Idempotent: if a worker is already running, report its pid and leave it
# alone, so two launchers racing on one sandbox can never start two workers.
if test -s "${PIDFILE}"; then
  existing=$(head -n1 "${PIDFILE}" 2>/dev/null | tr -d '[:space:]')
  # Match the probe: the group counts as live while any member is alive,
  # even if the setsid leader has already gone.
  if test -n "$existing" && { kill -0 "$existing" 2>/dev/null || pgrep -g "$existing" >/dev/null 2>&1; }; then
    if test -f "${EXITFILE}"; then
      # The worker itself exited but a task left a process behind in its
      # group. Nothing owns it any more: clear it and start the new worker.
      kill -KILL -- "-$existing" 2>/dev/null || true
      sleep 0.5
    else
      echo "$existing"
      exit 0
    fi
  fi
fi
rm -f "${PIDFILE}" "${EXITFILE}"
# Before reporting the exit, reap anything a task left behind in the worker's
# process group, so a written exit file always means the group is empty.
setsid bash -c 'bash "${RUNFILE}"; code=$?; stragglers=$(pgrep -g $$ | grep -vx $$ || true); [ -n "$stragglers" ] && kill -KILL $stragglers 2>/dev/null; printf "%s\\n" "$code" > "${EXITFILE}"' > "${LOGFILE}" 2>&1 < /dev/null 9>&- &
pid=$!
printf "%s\\n" "$pid" > "${PIDFILE}"
echo "$pid"
`

function runScript(workerCommand) {
  return `#!/bin/bash\nexec ${workerCommand}\n`
}

// Single-quote a value for run.sh so any pool name Cursor accepts is passed
// through intact, spaces and shell metacharacters included.
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export function workerCommand(pool) {
  if (!pool) throw new Error("pool name is required")
  const args = ["agent", "worker", "--pool", shellQuote(pool)]
  if (config.cloneGitRepos) args.push("--clone-git-repos")
  args.push("start")
  return args.join(" ")
}

// Env handed to the worker process. CURSOR_API_KEY is set on this command
// rather than sandbox-wide, but the agent's commands share the worker's user
// and can still read it: scope the service account to the pool.
export function workerEnv({ workerId, workerName }) {
  const env = {
    CURSOR_AGENT_WORKER_ID: workerId,
    CURSOR_WORKER_IDLE_RELEASE_TIMEOUT: config.idleReleaseTimeout,
  }
  env.CURSOR_API_KEY = process.env.CURSOR_API_KEY
  if (workerName) env.CURSOR_WORKER_NAME = workerName
  for (const key of ["CURSOR_API_URL", "CURSOR_API_ENDPOINT"]) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

// A missing probe script is reported as its own state: the spawn hook died
// after creating the sandbox but before installing the supervisor, and
// nothing will ever start a worker there.
const PROBE_COMMAND =
  `if test -f ${STATE_DIR}/probe.sh; then bash ${STATE_DIR}/probe.sh; ` +
  `else printf '{"state":"no_supervisor","pid":null,"exit_code":null}\\n'; fi`

export async function workerState(sandbox) {
  try {
    const result = await sandbox.commands.run(PROBE_COMMAND)
    const lines = result.stdout.trim().split("\n")
    if (lines.length > 0 && lines.at(-1)) return JSON.parse(lines.at(-1))
  } catch {
    // fall through
  }
  return { state: "unknown", pid: null, exit_code: null }
}

export async function stopWorker(sandbox) {
  // Fails loudly when any member of the worker's process group survives, so
  // callers never release a claim over a worker that is still alive.
  const result = await sandbox.commands.run(`bash ${STATE_DIR}/stop.sh`)
  if (result.exitCode !== 0)
    throw new Error(
      `stop failed: ${(result.stderr || "").trim() || `exit ${result.exitCode}`}`,
    )
}

export async function readLog(sandbox) {
  try {
    return await sandbox.files.readText(LOGFILE)
  } catch (e) {
    return `(could not read ${LOGFILE}: ${e.message})`
  }
}

// `command` overrides the worker command; tests use it to run a stand-in process.
export async function launchWorker(sandbox, { pool, env, command }) {
  await sandbox.commands.run(`mkdir -p ${STATE_DIR}`)
  await Promise.all([
    sandbox.files.write(`${STATE_DIR}/launch.sh`, LAUNCH_SCRIPT),
    sandbox.files.write(RUNFILE, runScript(command ?? workerCommand(pool))),
    sandbox.files.write(`${STATE_DIR}/probe.sh`, PROBE_SCRIPT),
    sandbox.files.write(`${STATE_DIR}/stop.sh`, STOP_SCRIPT),
  ])

  const result = await sandbox.commands.run(`bash ${STATE_DIR}/launch.sh`, {
    env,
  })
  const pid = Number.parseInt(result.stdout.trim().split("\n").at(-1) ?? "", 10)
  if (Number.isNaN(pid)) {
    return {
      ok: false,
      state: { state: "no_pidfile", pid: null, exit_code: null },
      log: await readLog(sandbox),
    }
  }

  await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS))
  const state = await workerState(sandbox)
  if (state.state !== "running")
    return { ok: false, state, log: await readLog(sandbox) }
  return { ok: true, pid, state }
}

const LIVE_STATUSES = new Set([
  "starting",
  "active",
  "pausing",
  "paused",
  "resuming",
])

// Remove the relaunch marker only if it is still the one this attempt wrote.
// Marker ownership is per attempt: a concurrent launcher may have replaced it
// with a newer stamp, and that marker must survive until its owner clears it.
export async function clearOwnMarker(sandbox, stamp) {
  try {
    // One read, one write from that same snapshot: the check and the removal
    // must not be separated by a second read that could see a newer marker.
    const info = await sandbox.getInfo()
    if (info.metadata[META_LAUNCHING] !== stamp) return
    const metadata = { ...info.metadata }
    delete metadata[META_LAUNCHING]
    await Sandbox.updateById(sandbox.id, { metadata })
  } catch {
    // Best effort; the marker expires with the grace period anyway.
  }
}

// Merge metadata updates into the sandbox's existing tags. A null value
// removes the key; update() replaces the whole map, so read first.
export async function tagSandbox(sandbox, updates) {
  const info = await sandbox.getInfo()
  const metadata = { ...info.metadata }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete metadata[key]
    else metadata[key] = value
  }
  await sandbox.update({ metadata })
}

export async function findSandboxForWorker(workerId) {
  const matches = await Sandbox.list({
    metadata: { [META_WORKER_ID]: workerId },
  })
  return matches.find((s) => LIVE_STATUSES.has(s.status)) ?? null
}

// --- Cursor pool API (service-account key, Basic auth) ---------------------

async function cursorApi(path, { method = "GET", body } = {}) {
  const auth = Buffer.from(`${process.env.CURSOR_API_KEY}:`).toString("base64")
  const init = {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  // Bounded like the Python client: a hung Cursor endpoint must not stall
  // the monitor loop indefinitely.
  init.signal = AbortSignal.timeout(30_000)
  const res = await fetch(`${config.cursorEndpoint}${path}`, init)
  if (!res.ok)
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// Hand a claimed request back to the queue when the worker could not start.
// Retried with backoff: a claim that stays attached to a worker that will
// never connect sits idle until Cursor expires it. If every attempt fails,
// the error names the request so the release can be done by hand.
export async function releaseClaim(requestId, { attempts = 4 } = {}) {
  const path = `/v0/private-workers/claims/${encodeURIComponent(requestId)}/release`
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return await cursorApi(path, { method: "POST" })
    } catch (e) {
      lastError = e
      if (i < attempts - 1)
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
    }
  }
  throw new Error(
    `release of request=${requestId} failed after ${attempts} attempts (${lastError.message}); ` +
      `release it manually: POST ${config.cursorEndpoint}${path}`,
  )
}

export async function listPendingRequests(pool) {
  const requests = []
  let pageToken
  do {
    const params = new URLSearchParams({ limit: "100" })
    if (pool) params.set("pool", pool)
    if (pageToken) params.set("pageToken", pageToken)
    const page = await cursorApi(
      `/v0/private-workers/pending-requests?${params}`,
    )
    requests.push(...(page?.requests ?? []))
    pageToken = page?.nextPageToken
  } while (pageToken)
  return requests
}
