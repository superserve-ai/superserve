#!/usr/bin/env node
// Long-running janitor for worker sandboxes. When a worker exits (idle
// release, crash, or manual stop) the sandbox is deleted, or paused when
// CURSOR_WORKER_HIBERNATE=true. In hibernate mode it also watches the pool's
// pending requests and resumes a paused sandbox when Cursor asks for its
// worker again (a claimed-but-offline entry with that worker id).
import "./env.mjs"
import { Sandbox } from "@superserve/sdk"

import {
  META_MANAGED,
  META_LAUNCHING,
  META_POOL,
  META_RECYCLING,
  META_REQUEST_ID,
  META_WORKER_ID,
  clearOwnMarker,
  config,
  launchWorker,
  tagSandbox,
  listPendingRequests,
  releaseClaim,
  stopWorker,
  workerEnv,
  workerState,
} from "./worker.mjs"

for (const key of ["SUPERSERVE_API_KEY", "CURSOR_API_KEY"]) {
  // Both are required: without the Cursor key the monitor could neither
  // wake hibernated workers nor release the claims of crashed ones, and
  // would fail those requests silently instead of loudly here.
  if (!process.env[key]) {
    console.error(`monitor: ${key} is not set`)
    process.exit(2)
  }
}

// Probe states that confirm no worker is running; anything else (including a
// transient probe failure) is inconclusive and must not release a claim.
const STOPPED_STATES = new Set(["exited", "dead", "no_pidfile"])
const TERMINAL_STATES = new Set([
  "exited",
  "dead",
  "no_pidfile",
  "no_supervisor",
])
const ONCE = process.argv.includes("--once")
const POLL_MS = Number(process.env.MONITOR_POLL_SECONDS || 15) * 1000
const WAKE_CONCURRENCY = Number(process.env.MONITOR_WAKE_CONCURRENCY || 4)
const GRACE_MS = Number(process.env.MONITOR_GRACE_SECONDS || 120) * 1000
const WAKE_ENABLED = config.hibernate
const pool = process.env.CURSOR_POOL
if (!pool) {
  // Without a pool the sweep would cover every worker sandbox on the team,
  // including other pools' hibernated workers.
  console.error("monitor: CURSOR_POOL is not set")
  process.exit(2)
}

let shuttingDown = false
const waking = new Set()

// The request a worker is currently serving, resolved live from Cursor's
// queue: warm workers are created without a request tag, and a hibernated
// sandbox may have been retagged since. Falls back to the creation-time tag.
async function claimedRequestFor(workerId, fallback) {
  // Returns { ok: false } when the lookup itself failed, so callers can defer
  // a destructive step instead of proceeding on a guess.
  if (!process.env.CURSOR_API_KEY) return { ok: true, requestId: fallback }
  try {
    const hit = (await listPendingRequests(pool)).find(
      (r) => r.claimedWorkerId === workerId,
    )
    return { ok: true, requestId: hit?.id ?? fallback }
  } catch (e) {
    console.warn(
      `monitor: could not look up the claim for worker=${workerId}: ${e.message}`,
    )
    return { ok: false }
  }
}

// True when another live sandbox now carries this worker id: a replacement
// spawn has taken over the request, and releasing its claim would strand it.
// Checked immediately before every release, after the old sandbox is gone.
const LIVE_STATUSES = new Set([
  "starting",
  "active",
  "pausing",
  "paused",
  "resuming",
])

async function replacementExists(workerId, excludeId) {
  try {
    const live = await Sandbox.list({
      metadata: { [META_WORKER_ID]: workerId },
    })
    // Only a sandbox that can still run a worker counts. A failed or deleted
    // record can never serve the claim, so it must not suppress the release.
    return live.some((s) => s.id !== excludeId && LIVE_STATUSES.has(s.status))
  } catch (e) {
    console.warn(
      `monitor: could not check for a replacement of worker=${workerId}: ${e.message}`,
    )
    return true // inconclusive: do not release
  }
}

async function recycle(info) {
  const sandbox = await Sandbox.connect(info.id)
  const state = await workerState(sandbox)
  // Only act on confirmed terminal states. An inconclusive probe (transient
  // exec error, malformed output) is retried on the next sweep.
  if (!TERMINAL_STATES.has(state.state)) {
    if (state.state !== "running")
      console.warn(
        `monitor: sandbox=${info.id} probe inconclusive (${state.state}), retrying next sweep`,
      )
    return
  }

  // `info` is a snapshot from the sweep's list call. A spawn hook may have
  // marked this sandbox for relaunch since; re-read before acting so the
  // recycle never races a relaunch that is already under way.
  const current = await sandbox.getInfo()
  const launching = Number(current.metadata[META_LAUNCHING] || 0)
  if (launching && Date.now() - launching < GRACE_MS) {
    console.log(
      `monitor: sandbox=${info.id} marked for relaunch, leaving it alone`,
    )
    return
  }
  // Metadata has no compare-and-swap, so ownership is claimed by writing a
  // marker and re-reading: a spawn hook that marks the sandbox for relaunch
  // in the same window sees our marker and starts a fresh sandbox instead,
  // and if its marker landed first we back off here. What remains is the
  // width of one round-trip, and the launch lock keeps even that from
  // starting two workers.
  await Sandbox.updateById(info.id, {
    metadata: { ...current.metadata, [META_RECYCLING]: String(Date.now()) },
  })
  const recheck = await sandbox.getInfo()
  const launchingNow = Number(recheck.metadata[META_LAUNCHING] || 0)
  // Probe again now that ownership is recorded: a relaunch that slipped in
  // between the first probe and the marker write shows up here as a live
  // worker, even if its marker was lost to the whole-map write above.
  const stateNow = await workerState(sandbox)
  const relaunched =
    stateNow.state === "running" || !TERMINAL_STATES.has(stateNow.state)
  if ((launchingNow && Date.now() - launchingNow < GRACE_MS) || relaunched) {
    await Sandbox.updateById(info.id, {
      metadata: { ...recheck.metadata, [META_RECYCLING]: undefined },
    }).catch(() => {})
    console.log(
      `monitor: sandbox=${info.id} claimed for relaunch during recycle, backing off`,
    )
    return
  }

  const worker = info.metadata[META_WORKER_ID]
  const detail = `state=${state.state} exit=${state.exit_code ?? "-"} worker=${worker}`
  // With hibernation on, a sandbox whose worker was stopped deliberately
  // (no pid file left behind, e.g. after a failed relaunch) still holds a
  // workspace a follow-up may want: pause it like any other exited worker.
  // Only a sandbox that never got a supervisor, or one without hibernation,
  // is reclaimed outright.
  const abandoned =
    state.state === "no_supervisor" ||
    (state.state === "no_pidfile" && !config.hibernate)
  if (abandoned) {
    // No worker ever ran here, or it was stopped deliberately: the spawn hook
    // died before installing the supervisor or before the launch wrote a pid.
    // Past the grace period nothing will start one, so reclaim the sandbox
    // outright.
    // Read the tags one last time right before the kill: a retried spawn
    // that saw our recycle marker supersedes this sandbox and starts a
    // replacement for the same request, and that request must then stay
    // claimed for the replacement rather than be released here.
    const latest = await sandbox.getInfo().catch(() => recheck)
    const superseded = String(latest.metadata[META_WORKER_ID] || "").endsWith(
      ".superseded",
    )
    console.log(`monitor: deleting abandoned sandbox=${info.id} ${detail}`)
    await sandbox.kill()
    // Otherwise the request it was claimed for has no worker and never will;
    // hand it back so it can be served elsewhere instead of waiting for
    // Cursor to expire the claim.
    const requestId = superseded ? undefined : latest.metadata[META_REQUEST_ID]
    if (superseded)
      console.log(
        `monitor: sandbox=${info.id} was superseded by a replacement; leaving its claim alone`,
      )
    if (requestId && (await replacementExists(worker, info.id))) {
      console.log(
        `monitor: a replacement sandbox now serves worker=${worker}; leaving request=${requestId} claimed`,
      )
      return
    }
    if (requestId && process.env.CURSOR_API_KEY) {
      try {
        await releaseClaim(requestId)
        console.log(`monitor: released claim request=${requestId}`)
      } catch (e) {
        console.error(`monitor: ${e.message}`)
      }
    }
    return
  }
  if (config.hibernate) {
    console.log(`monitor: pausing sandbox=${info.id} ${detail}`)
    await sandbox.pause({ wait: true })
    // The paused sandbox is reusable again; drop the ownership marker. Merge
    // into the metadata as it is now, not the pre-pause snapshot: a spawn
    // that overlapped the pause may have retagged this sandbox meanwhile.
    try {
      const latest = await sandbox.getInfo()
      await Sandbox.updateById(info.id, {
        metadata: { ...latest.metadata, [META_RECYCLING]: undefined },
      })
    } catch (e) {
      console.warn(
        `monitor: could not clear recycle marker on sandbox=${info.id}: ${e.message}`,
      )
    }
  } else {
    // A clean idle exit (code 0) was already freed by Cursor. Anything else
    // is a crash: the request it was serving is still claimed by a worker
    // that no longer exists, so hand it back after the delete.
    const crashed = state.state === "dead" || (state.exit_code ?? 0) !== 0
    const latest = await sandbox.getInfo().catch(() => recheck)
    const superseded = String(latest.metadata[META_WORKER_ID] || "").endsWith(
      ".superseded",
    )
    // Resolve the claim before the delete: once the sandbox is gone there is
    // nothing left to retry from. An inconclusive lookup defers the recycle
    // to the next sweep rather than orphaning the request.
    let requestId
    if (crashed && !superseded) {
      const lookup = await claimedRequestFor(
        latest.metadata[META_WORKER_ID],
        latest.metadata[META_REQUEST_ID],
      )
      if (!lookup.ok) {
        console.warn(
          `monitor: deferring recycle of sandbox=${info.id} until its claim can be resolved`,
        )
        return
      }
      requestId = lookup.requestId
    }
    console.log(`monitor: deleting sandbox=${info.id} ${detail}`)
    await sandbox.kill()
    if (requestId && (await replacementExists(worker, info.id))) {
      console.log(
        `monitor: a replacement sandbox now serves worker=${worker}; leaving request=${requestId} claimed`,
      )
      return
    }
    if (requestId && process.env.CURSOR_API_KEY) {
      try {
        await releaseClaim(requestId)
        console.log(
          `monitor: released claim request=${requestId} after worker crash`,
        )
      } catch (e) {
        console.error(`monitor: ${e.message}`)
      }
    }
  }
}

async function reapFailed(info) {
  const workerId = info.metadata[META_WORKER_ID]
  const superseded = String(workerId || "").endsWith(".superseded")
  // Resolve the claim before deleting: once the sandbox is gone nothing can
  // retry an inconclusive lookup, so an outage here defers to the next sweep.
  let requestId
  if (!superseded) {
    const lookup = await claimedRequestFor(
      workerId,
      info.metadata[META_REQUEST_ID],
    )
    if (!lookup.ok) {
      console.warn(
        `monitor: claim lookup for failed sandbox=${info.id} inconclusive, retrying next sweep`,
      )
      return
    }
    requestId = lookup.requestId
  }
  console.log(`monitor: deleting failed sandbox=${info.id} worker=${workerId}`)
  await Sandbox.killById(info.id)
  if (!requestId) return
  if (await replacementExists(workerId, info.id)) {
    console.log(
      `monitor: a replacement for worker=${workerId} exists, leaving request=${requestId} claimed`,
    )
    return
  }
  try {
    await releaseClaim(requestId)
    console.log(
      `monitor: released claim request=${requestId} after sandbox failure`,
    )
  } catch (e) {
    console.error(`monitor: ${e.message}`)
  }
}

async function sweep() {
  // Scope to this monitor's pool so parallel pool deployments never touch
  // each other's sandboxes.
  const sandboxes = await Sandbox.list({
    metadata: { [META_MANAGED]: "true", [META_POOL]: pool },
  })
  const now = Date.now()
  for (const info of sandboxes) {
    if (info.status === "failed") {
      // A sandbox that failed to boot or resume never auto-deletes (that only
      // applies to paused ones) and its worker is gone for good: drop the
      // record and hand back whatever request it was claimed for.
      try {
        await reapFailed(info)
      } catch (e) {
        console.warn(`monitor: failed sandbox=${info.id} error: ${e.message}`)
      }
      continue
    }
    if (info.status !== "active") continue
    // Give a freshly spawned sandbox time to bring its worker up.
    if (now - info.createdAt.getTime() < GRACE_MS) continue
    // The spawn hook stamps a resumed sandbox while it relaunches the worker;
    // its createdAt is old, so give the relaunch the same grace.
    const launching = Number(info.metadata[META_LAUNCHING] || 0)
    if (launching && now - launching < GRACE_MS) continue
    if (waking.has(info.id)) continue
    try {
      await recycle(info)
    } catch (e) {
      console.warn(`monitor: sandbox=${info.id} error: ${e.message}`)
    }
  }
  return sandboxes
}

async function wakeOne(info, request) {
  const workerId = request.claimedWorkerId
  waking.add(info.id)
  try {
    console.log(
      `monitor: waking sandbox=${info.id} worker=${workerId} request=${request.id} ` +
        `window=${Math.round((request.wakeTimeoutMs ?? 0) / 1000)}s`,
    )
    // The spawn hook may be reviving this same worker if the controller
    // re-ran it for the follow-up. Check its marker through a list lookup,
    // which leaves a paused sandbox paused; connect() would resume it and
    // race the hook's own resume. The launch script holds a lock as well, so
    // whatever slips through here still cannot start two workers.
    const fresh = (
      await Sandbox.list({ metadata: { [META_WORKER_ID]: workerId } })
    ).find((s) => s.id === info.id)
    if (!fresh) return
    const launching = Number(fresh.metadata[META_LAUNCHING] || 0)
    if (launching && Date.now() - launching < GRACE_MS) {
      console.log(
        `monitor: sandbox=${info.id} is being launched by the spawn hook, skipping wake`,
      )
      return
    }
    // Retag with the follow-up's request id: if the relaunch fails, the
    // sweep must release this request, not the one the sandbox was created for.
    const stamp = String(Date.now())
    await Sandbox.updateById(info.id, {
      metadata: {
        ...fresh.metadata,
        [META_LAUNCHING]: stamp,
        [META_REQUEST_ID]: request.id,
      },
    })
    let sandbox
    try {
      sandbox = await Sandbox.connect(info.id)
    } catch (e) {
      // The marker must not outlive a failed activation, or the next sweeps
      // would skip this sandbox for the whole grace period. Clear only the
      // marker this attempt wrote, from a fresh read: a spawn hook that won
      // the activation has its own newer marker and request id in there.
      try {
        // Read through the list endpoint: connect() would activate the
        // sandbox, and a resumed sandbox with no worker is exactly what this
        // path must not leave behind.
        const now = (
          await Sandbox.list({ metadata: { [META_WORKER_ID]: workerId } })
        ).find((s) => s.id === info.id)
        if (now && now.metadata[META_LAUNCHING] === stamp) {
          await Sandbox.updateById(info.id, {
            metadata: { ...now.metadata, [META_LAUNCHING]: undefined },
          })
        }
      } catch {
        // Best effort; the marker expires with the grace period anyway.
      }
      throw e
    }
    try {
      if (sandbox.status === "paused") await sandbox.resume()
      const result = await launchWorker(sandbox, {
        pool: info.metadata[META_POOL] || pool,
        env: workerEnv({ workerId }),
      })
      if (result.ok) {
        console.log(
          `monitor: worker resumed pid=${result.pid} sandbox=${info.id} worker=${workerId}`,
        )
      } else {
        console.error(
          `monitor: worker failed to resume sandbox=${info.id} state=${result.state.state}\n` +
            result.log.slice(-2000),
        )
        // A confirmed failed wake must not leave the follow-up parked on a
        // worker that cannot serve it. Stop anything that survived, confirm
        // it is gone, then hand the request back; the next sweep recycles
        // the sandbox as usual.
        try {
          // A controller spawn may have started relaunching this sandbox after
          // our launch attempt failed. Check that before touching anything:
          // its marker means the worker in there (or about to be) is not ours
          // to stop, and the request is spoken for.
          const ownedByAnother = async () => {
            const latest = await sandbox.getInfo()
            const marker = latest.metadata[META_LAUNCHING]
            return (
              Boolean(marker) &&
              marker !== stamp &&
              Date.now() - Number(marker) < GRACE_MS
            )
          }
          if (await ownedByAnother())
            throw new Error(
              "another launcher has marked this sandbox; leaving it and the claim to it",
            )
          // stop.sh takes the launch lock, so a launch cannot interleave with
          // the stop and lose its pid file.
          await stopWorker(sandbox)
          const after = await workerState(sandbox)
          if (!STOPPED_STATES.has(after.state))
            throw new Error(`worker state=${after.state} not confirmed stopped`)
          // Re-validate immediately before releasing.
          if (await ownedByAnother())
            throw new Error(
              "another launcher has marked this sandbox; leaving the claim to it",
            )
          const again = await workerState(sandbox)
          if (again.state === "running")
            throw new Error(
              `worker pid=${again.pid} started meanwhile; leaving the claim`,
            )
          await releaseClaim(request.id)
          console.log(`monitor: released claim request=${request.id}`)
          // A released request must not be released again by a later sweep.
          await tagSandbox(sandbox, { [META_REQUEST_ID]: null }).catch(() => {})
        } catch (e) {
          console.error(
            `monitor: could not release request=${request.id}: ${e.message}`,
          )
        }
      }
    } finally {
      await clearOwnMarker(sandbox, stamp)
    }
  } finally {
    waking.delete(info.id)
  }
}

async function wake(sandboxes) {
  const paused = new Map()
  for (const s of sandboxes) {
    if (s.status === "paused" && s.metadata[META_WORKER_ID])
      paused.set(s.metadata[META_WORKER_ID], s)
  }
  if (paused.size === 0) return

  const requests = await listPendingRequests(pool)
  const pending = []
  for (const request of requests) {
    const info = request.claimedWorkerId
      ? paused.get(request.claimedWorkerId)
      : undefined
    if (!info || waking.has(info.id)) continue
    pending.push([info, request])
  }
  // Each wake waits out the worker's startup probe, so a burst of follow-ups
  // would otherwise revive one sandbox at a time and eat into every request's
  // reconnect window. Run them in bounded parallel; sandboxes are independent.
  let next = 0
  const runner = async () => {
    while (next < pending.length) {
      const [info, request] = pending[next++]
      try {
        await wakeOne(info, request)
      } catch (e) {
        console.error(`monitor: wake sandbox=${info.id} error: ${e.message}`)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WAKE_CONCURRENCY, pending.length) }, runner),
  )
}

process.once("SIGTERM", () => {
  shuttingDown = true
})
process.once("SIGINT", () => {
  shuttingDown = true
})

console.log(
  `monitor: watching template=${config.templateName} hibernate=${config.hibernate} ` +
    `wake=${WAKE_ENABLED} pool=${pool} every ${POLL_MS / 1000}s`,
)

// eslint-disable-next-line no-unmodified-loop-condition -- signal handlers flip shuttingDown.
while (!shuttingDown) {
  try {
    const sandboxes = await sweep()
    if (WAKE_ENABLED) await wake(sandboxes)
  } catch (e) {
    console.warn(`monitor: ${e.message}`)
  }
  if (ONCE) break
  await new Promise((r) => setTimeout(r, POLL_MS))
}
console.log("monitor: stopped")
