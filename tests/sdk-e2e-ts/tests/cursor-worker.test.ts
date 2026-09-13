import { Sandbox, Template } from "@superserve/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  ensureTemplate,
  resolveCursorCliVersion,
  TEMPLATE_SPEC_HASH,
} from "../../../guides/managed-agents/cursor-cloud-agents/typescript/template.mjs"
import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

// Content-addressed: a spec change in the guide, or a new CLI release from
// the installer the spec runs, yields a fresh template here instead of
// silently testing an older image under the documented name.
const TEMPLATE_PREFIX = "cursor-worker-e2e-"
// Resolved once, from suite setup rather than at module load, so a run that
// selects only other tests never depends on reaching cursor.com.
let templateNamePromise: Promise<string> | undefined
function templateName() {
  templateNamePromise ??= resolveCursorCliVersion().then(
    (cli) => `${TEMPLATE_PREFIX}${TEMPLATE_SPEC_HASH}-${cli}`,
  )
  return templateNamePromise
}

// Every spec revision leaves a template behind, and the team has a template
// quota, so drop old versions before building. A run on another revision may
// overlap with this one on the same team, so only templates older than a day
// are reaped, and createSandboxFromTemplate below rebuilds and retries if a
// template still disappears between its readiness check and use.
const TEMPLATE_STALE_MS = 24 * 60 * 60 * 1000
// Sandboxes this file creates all carry this name prefix. One left behind by
// a crashed run keeps its template undeletable in any status, so orphans
// older than an hour go first; no run of this suite lives that long.
const SANDBOX_PREFIX = "sdk-e2e-cursor-"
const SANDBOX_ORPHAN_MS = 60 * 60 * 1000
async function reapStaleTemplates() {
  const orphanCutoff = Date.now() - SANDBOX_ORPHAN_MS
  const orphans = (await Sandbox.list()).filter(
    (s) =>
      s.name.startsWith(SANDBOX_PREFIX) && s.createdAt.getTime() < orphanCutoff,
  )
  await Promise.all(
    orphans.map((s) =>
      Sandbox.killById(s.id).catch((err) =>
        console.error(`Could not delete orphaned sandbox ${s.id}:`, err),
      ),
    ),
  )
  const current = await templateName()
  const cutoff = Date.now() - TEMPLATE_STALE_MS
  const stale = (await Template.list({ namePrefix: TEMPLATE_PREFIX })).filter(
    (t) => t.name !== current && t.createdAt.getTime() < cutoff,
  )
  await Promise.all(
    stale.map((t) =>
      Template.deleteById(t.name).catch((err) =>
        console.error(`Could not delete stale template ${t.name}:`, err),
      ),
    ),
  )
}
import {
  findSandboxForWorker,
  launchWorker,
  META_MANAGED,
  META_POOL,
  META_WORKER_ID,
  readLog,
  stopWorker,
  workerEnv,
  workerState,
} from "../../../guides/managed-agents/cursor-cloud-agents/typescript/worker.mjs"

// Exercises the Cursor Self-Hosted Machines guide against a live environment
// without a Cursor account: the template, the detached worker supervisor, the
// real worker binary's failure path, and the hibernate/resume lookup. The live
// Cursor loop (a service-account key, a real pool) is out of scope here.
//
// The guide's helpers read connection settings from the environment, so the
// suite's options are exported before they load.
const opts = hasCredentials()
  ? connectionOptions()
  : { apiKey: "", baseUrl: "" }
if (hasCredentials()) {
  process.env.SUPERSERVE_API_KEY = opts.apiKey
  if (opts.baseUrl) process.env.SUPERSERVE_BASE_URL = opts.baseUrl
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const POOL = "sdk-e2e"

// Sandbox creation that survives another run reaping this run's template:
// if the create fails and the template is gone, build it again and retry once.
// Every sandbox also gets a bounded life, so one orphaned by a crashed run
// pauses, is deleted, and stops holding a reference that would make its
// template undeletable.
async function createSandboxFromTemplate(
  options: Omit<Parameters<typeof Sandbox.create>[0], "fromTemplate">,
) {
  const name = await templateName()
  const create = () =>
    Sandbox.create({
      timeoutSeconds: 30 * 60,
      autoDeleteSeconds: 10 * 60,
      ...options,
      fromTemplate: name,
    })
  try {
    return await create()
  } catch (err) {
    const still = (await Template.list({ namePrefix: name })).some(
      (t) => t.name === name,
    )
    if (still) throw err
    await ensureTemplate({ name, log: () => {} })
    return await create()
  }
}

describe.skipIf(!hasCredentials())("cursor worker guide", () => {
  const workerId = `sdk-e2e-${RUN_ID}`
  let sandbox: Sandbox

  // First run on a team builds the template (about a minute); later runs reuse it.
  beforeAll(async () => {
    await reapStaleTemplates()
    await ensureTemplate({ name: await templateName(), log: () => {} })
    sandbox = await createSandboxFromTemplate({
      name: `sdk-e2e-cursor-${RUN_ID}`,
      metadata: {
        [META_MANAGED]: "true",
        [META_WORKER_ID]: workerId,
        [META_POOL]: POOL,
      },
      ...opts,
    })
  }, 300_000)

  afterAll(async () => {
    if (!sandbox?.id) return
    try {
      await sandbox.kill()
    } catch (err) {
      console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
    }
  })

  it("boots with the Cursor CLI on PATH", async () => {
    const r = await sandbox.commands.run(
      "agent --version && git --version && test -d /workspace",
    )
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/\d{4}\.\d{2}\.\d{2}/)
  })

  it("launches a detached process that outlives the exec call", async () => {
    const res = await launchWorker(sandbox, {
      pool: POOL,
      env: {},
      command: "sleep 300",
    })
    expect(res.ok).toBe(true)
    await sleep(3000)
    const state = await workerState(sandbox)
    expect(state.state).toBe("running")
    expect(state.pid).toBe(res.ok ? res.pid : null)
  })

  it("launching again while the worker runs reuses it instead of starting a second", async () => {
    // Start a worker here so the test stands on its own when selected
    // individually; if one is already running from an earlier test, this
    // returns it unchanged.
    const started = await launchWorker(sandbox, {
      pool: POOL,
      env: {},
      command: "sleep 300",
    })
    expect(started.ok).toBe(true)
    const first = await workerState(sandbox)
    expect(first.state).toBe("running")
    const res = await launchWorker(sandbox, {
      pool: POOL,
      env: {},
      command: "sleep 300",
    })
    expect(res.ok && res.pid).toBe(first.pid)
    const count = await sandbox.commands.run("pgrep -x sleep | wc -l")
    expect(count.stdout.trim()).toBe("1")
  })

  it("stops the process group and clears its state files", async () => {
    // Start a stand-in here so the test stands on its own when selected
    // individually; if one is already running from an earlier test, this
    // returns it unchanged.
    const started = await launchWorker(sandbox, {
      pool: POOL,
      env: {},
      command: "sleep 300",
    })
    expect(started.ok).toBe(true)
    const before = await workerState(sandbox)
    expect(before.state).toBe("running")
    await stopWorker(sandbox)
    const after = await workerState(sandbox)
    expect(after.state).toBe("no_pidfile")
    const alive = await sandbox.commands.run(
      `kill -0 ${before.pid} 2>/dev/null && echo ALIVE || echo GONE`,
    )
    expect(alive.stdout.trim()).toBe("GONE")
  })

  it("captures the exit code of a process that ends", async () => {
    const res = await launchWorker(sandbox, {
      pool: POOL,
      env: {},
      command: "sh -c 'exit 7'",
    })
    expect(res.ok).toBe(false)
    expect(res.state).toMatchObject({ state: "exited", exit_code: 7 })
  })

  it("runs the real worker binary and surfaces its failure", async () => {
    // A bogus key proves the binary starts, reads its env, and reaches Cursor
    // far enough to be rejected. The log tail is what the spawn hook prints.
    // Cursor may take longer than the launch helper's startup grace to reject
    // the key, so poll for the exit with a bound rather than assume it lands
    // inside that window.
    process.env.CURSOR_API_KEY = "not-a-real-cursor-key"
    const res = await launchWorker(sandbox, {
      pool: POOL,
      env: workerEnv({ workerId, workerName: "sdk-e2e" }),
    })
    let state = res.state
    const deadline = Date.now() + 60_000
    while (state.state === "running" && Date.now() < deadline) {
      await sleep(3000)
      state = await workerState(sandbox)
    }
    if (state.state === "running") await stopWorker(sandbox)
    expect(state.state).toBe("exited")
    expect(await readLog(sandbox)).toMatch(/API key/i)
  }, 120_000)

  it("is found by worker id after a pause, with its workspace intact", async () => {
    await sandbox.commands.run("echo keepme > /workspace/marker.txt")
    await sandbox.pause()

    const found = await findSandboxForWorker(workerId)
    expect(found?.id).toBe(sandbox.id)
    expect(found?.status).toBe("paused")

    const resumed = await Sandbox.connect(found!.id, opts)
    if (resumed.status === "paused") await resumed.resume()
    const r = await resumed.commands.run("cat /workspace/marker.txt")
    expect(r.stdout.trim()).toBe("keepme")
  }, 180_000)
})

describe.skipIf(!hasCredentials())("cursor worker: abandoned spawn", () => {
  const opts = hasCredentials()
    ? connectionOptions()
    : { apiKey: "", baseUrl: "" }
  let sandbox: Sandbox

  beforeAll(async () => {
    await reapStaleTemplates()
    await ensureTemplate({ name: await templateName(), log: () => {} })
    sandbox = await createSandboxFromTemplate({
      name: `sdk-e2e-cursor-abandoned-${RUN_ID}`,
      ...opts,
    })
  }, 300_000)

  afterAll(async () => {
    try {
      await sandbox?.kill()
    } catch {}
  })

  it("reports no_supervisor when the spawn hook never installed one", async () => {
    const state = await workerState(sandbox)
    expect(state).toEqual({
      state: "no_supervisor",
      pid: null,
      exit_code: null,
    })
  })
})
