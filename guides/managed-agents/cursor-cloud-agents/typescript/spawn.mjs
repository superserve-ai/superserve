#!/usr/bin/env node
// --spawn hook for `agent worker controller`. Runs once per claimed request
// (or once per missing warm worker) with CURSOR_* set by the controller.
// Creates a Superserve sandbox and starts a Cursor pool worker inside it.
import "./env.mjs"
import { mkdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"

import { ConflictError, Sandbox } from "@superserve/sdk"

import {
  META_MANAGED,
  META_LAUNCHING,
  META_POOL,
  META_REPO,
  META_REQUEST_ID,
  META_WORKER_ID,
  clearOwnMarker,
  META_RECYCLING,
  config,
  findSandboxForWorker,
  launchWorker,
  releaseClaim,
  stopWorker,
  tagSandbox,
  workerEnv,
  workerState,
} from "./worker.mjs"

for (const key of [
  "SUPERSERVE_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_AGENT_WORKER_ID",
  "CURSOR_POOL",
]) {
  if (!process.env[key]) {
    console.error(`spawn: ${key} is not set`)
    process.exit(2)
  }
}

// Must match the monitor's MONITOR_GRACE_SECONDS: markers older than this are stale.
const LIVE_STATUSES = new Set([
  "starting",
  "active",
  "pausing",
  "paused",
  "resuming",
])
const GRACE_MS = Number(process.env.MONITOR_GRACE_SECONDS || 120) * 1000
// Probe states that confirm no worker is running; anything else (including a
// transient probe failure) is inconclusive and must not release a claim.
const STOPPED_STATES = new Set(["exited", "dead", "no_pidfile"])
const workerId = process.env.CURSOR_AGENT_WORKER_ID
const pool = process.env.CURSOR_POOL
const requestId = process.env.CURSOR_REQUEST_ID
const workerName = process.env.CURSOR_WORKER_NAME
const repo =
  process.env.CURSOR_REPO_OWNER && process.env.CURSOR_REPO_NAME
    ? `${process.env.CURSOR_REPO_OWNER}/${process.env.CURSOR_REPO_NAME}`
    : undefined

function sandboxName() {
  const short = workerId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12)
  return `cursor-${short || "worker"}`
}

async function createSandbox() {
  const metadata = {
    [META_MANAGED]: "true",
    [META_WORKER_ID]: workerId,
    [META_POOL]: pool,
  }
  if (requestId) metadata[META_REQUEST_ID] = requestId
  if (repo) metadata[META_REPO] = repo

  const options = {
    name: sandboxName(),
    fromTemplate: config.templateName,
    metadata,
    autoDeleteSeconds: config.autoDeleteSeconds,
  }
  if (config.allowOut.length > 0) {
    options.network = { allowOut: config.allowOut, denyOut: ["0.0.0.0/0"] }
  }
  return Sandbox.create(options)
}

// Tear down whatever this spawn started, then hand the request back. The
// release comes last and only once the worker is confirmed gone: releasing
// first would let Cursor reassign the request while a worker that survived a
// transient probe failure keeps serving it. If teardown fails, the claim is
// kept and the failure is loud rather than silently doubled.
// True when another live sandbox carries this worker id (a replacement spawn
// has taken over the request). Inconclusive lookups count as "exists" so a
// claim is never released on a guess.
async function replacementExists(workerId, excludeId) {
  try {
    const live = await Sandbox.list({
      metadata: { [META_WORKER_ID]: workerId },
    })
    return live.some((s) => s.id !== excludeId && LIVE_STATUSES.has(s.status))
  } catch (e) {
    console.error(
      `spawn: could not check for a replacement of worker=${workerId}: ${e.message}`,
    )
    return true
  }
}

async function abandon(sandbox, created) {
  if (sandbox) {
    try {
      if (created) {
        await sandbox.kill()
      } else {
        await stopWorker(sandbox)
        const after = await workerState(sandbox)
        if (!STOPPED_STATES.has(after.state))
          throw new Error(`worker state=${after.state} not confirmed stopped`)
      }
    } catch (e) {
      // If the sandbox is already gone (the monitor recycled it in the
      // window between our marker write and its own, which whole-map
      // metadata updates cannot exclude), there is no worker left to serve
      // the request: treat that as torn down and release the claim below.
      const gone = await Sandbox.list({
        metadata: { [META_WORKER_ID]: workerId },
      })
        .then(
          (all) =>
            !all.some((s) => s.id === sandbox.id && s.status !== "deleted"),
        )
        .catch(() => false)
      if (!gone) {
        console.error(
          `spawn: could not ${created ? "delete sandbox" : "stop worker in sandbox"}=${sandbox.id}: ${e.message}; ` +
            `keeping the claim${requestId ? ` request=${requestId}` : ""}`,
        )
        return false
      }
      console.error(
        `spawn: sandbox=${sandbox.id} is already gone (${e.message}); treating it as torn down`,
      )
    }
  }
  if (requestId) {
    // A retry on another host may have created a replacement for this
    // worker id in the meantime; its worker is about to serve the request,
    // so the claim must stay put.
    if (await replacementExists(workerId, sandbox?.id)) {
      console.error(
        `spawn: a replacement for worker=${workerId} exists; leaving request=${requestId} claimed`,
      )
      return true
    }
    try {
      await releaseClaim(requestId)
      console.error(`spawn: released claim request=${requestId}`)
      // A released request must not be released again by a later sweep.
      if (sandbox && !created)
        await tagSandbox(sandbox, { [META_REQUEST_ID]: null }).catch(() => {})
    } catch (e) {
      console.error(
        `spawn: could not release claim request=${requestId}: ${e.message}`,
      )
    }
  }
  return true
}

// Retag a sandbox the monitor is recycling so it can no longer be found by
// worker id: with hibernation on it may be paused rather than deleted, and a
// replacement is about to be created under the same id.
async function supersede(info) {
  // Returns false if the tag could not be written: without it the monitor
  // cannot tell the old sandbox from a live one, so no replacement may be
  // created on top of it.
  try {
    await Sandbox.updateById(info.id, {
      metadata: {
        ...info.metadata,
        [META_WORKER_ID]: `${info.metadata[META_WORKER_ID]}.superseded`,
      },
    })
    return true
  } catch (e) {
    console.error(
      `spawn: could not mark sandbox=${info.id} as superseded: ${e.message}`,
    )
    return false
  }
}

async function main() {
  let sandbox
  let created = false
  // Set once we know no other sandbox can be serving this worker id. Until
  // then a failure must keep the claim: releasing it while a live worker may
  // exist would let Cursor run the request twice.
  let absenceConfirmed = false
  // Identifies this attempt's relaunch marker so cleanup never removes another's.
  const launchStamp = String(Date.now())

  try {
    // A paused sandbox tagged with this worker id is a hibernated workspace
    // (see the monitor). Resume it instead of starting from scratch.
    const existing = await findSandboxForWorker(workerId)
    let reuse = Boolean(existing)
    if (!existing) absenceConfirmed = true
    if (reuse) {
      console.log(
        `spawn: reusing sandbox=${existing.id} status=${existing.status} worker=${workerId}`,
      )
      // Tell the monitor a relaunch is in progress before anything resumes the
      // sandbox: connect() auto-resumes, and the previous worker's exit file
      // is visible the moment it does.
      try {
        await Sandbox.updateById(existing.id, {
          metadata: {
            ...existing.metadata,
            [META_LAUNCHING]: launchStamp,
            ...(requestId ? { [META_REQUEST_ID]: requestId } : {}),
          },
        })
      } catch (e) {
        // Nothing has been touched yet, and the existing worker may be live
        // or mid-resume by the monitor: keep the claim rather than release a
        // request that sandbox may be about to serve.
        console.error(
          `spawn: could not mark sandbox=${existing.id} for relaunch (${e.message}); keeping the claim`,
        )
        return 1
      }
      // Re-read after marking: if the monitor is pausing or deleting this
      // sandbox right now, it is not ours to reuse. Start a fresh one instead.
      const recheck = (
        await Sandbox.list({ metadata: { [META_WORKER_ID]: workerId } })
      ).find((s) => s.id === existing.id)
      const recycling = Number(recheck?.metadata[META_RECYCLING] || 0)
      if (!recheck || (recycling && Date.now() - recycling < GRACE_MS)) {
        if (recheck) {
          const ok = await supersede({
            id: existing.id,
            metadata: {
              ...recheck.metadata,
              ...(recheck.metadata[META_LAUNCHING] === launchStamp
                ? { [META_LAUNCHING]: undefined }
                : {}),
            },
          })
          if (!ok) {
            console.error(
              `spawn: keeping the claim; the controller can retry once sandbox=${existing.id} is recycled`,
            )
            return 1
          }
        }
        console.log(
          `spawn: sandbox=${existing.id} is being recycled by the monitor, starting a new one`,
        )
        // The old sandbox is gone or retagged, so nothing else can serve this
        // worker id: if the replacement fails to create, the claim must be
        // released rather than kept.
        absenceConfirmed = true
        reuse = false
      }
    }
    if (reuse) {
      // The monitor's wake path may be resuming this same sandbox, or its
      // sweep may be recycling it. Either shows up here as a conflict.
      try {
        sandbox = await Sandbox.connect(existing.id)
        if (sandbox.status === "paused") await sandbox.resume()
      } catch (e) {
        // The relaunch marker is left in place: marker ownership and activation
        // ownership are independent, so a stamp check cannot tell whether the
        // winner's marker is the one stored. Whoever completes the launch
        // clears it, and it expires with the grace period regardless.
        if (!(e instanceof ConflictError)) {
          // A transport failure may have lost the activation response while
          // the sandbox came up anyway, possibly with a live worker. Release
          // only once a probe confirms nothing is running there; otherwise
          // keep the claim and let the controller retry.
          console.error(
            `spawn: could not resume sandbox=${existing.id}: ${e.message}`,
          )
          let probed
          let probedSandbox
          try {
            probedSandbox = await Sandbox.connect(existing.id)
            probed = await workerState(probedSandbox)
          } catch (probeErr) {
            console.error(
              `spawn: sandbox=${existing.id} unreachable for a probe (${probeErr.message}); keeping the claim`,
            )
            return 1
          }
          if (probed.state === "running") {
            console.error(
              `spawn: worker pid=${probed.pid} is running in sandbox=${existing.id}; keeping the claim`,
            )
            return 1
          }
          if (probed.state === "unknown") {
            console.error(
              `spawn: worker state in sandbox=${existing.id} is inconclusive; keeping the claim`,
            )
            return 1
          }
          // Hand the probed sandbox to the teardown so it is recognized as
          // ours (and not mistaken for a replacement) when the claim is released.
          await abandon(probedSandbox, false)
          return 1
        }
        // Re-read to tell the two apart. A wake in progress is about to
        // serve the request, so keep the claim for it. A recycle in progress
        // means nothing will serve it there, so start a replacement.
        const now = (
          await Sandbox.list({ metadata: { [META_WORKER_ID]: workerId } })
        ).find((s) => s.id === existing.id)
        const recyclingNow = Number(now?.metadata[META_RECYCLING] || 0)
        if (now && !(recyclingNow && Date.now() - recyclingNow < GRACE_MS)) {
          console.error(
            `spawn: sandbox=${existing.id} is being resumed by another launcher (${e.message}); keeping the claim`,
          )
          return 1
        }
        if (now && !(await supersede(now))) {
          console.error(
            `spawn: keeping the claim; the controller can retry once sandbox=${existing.id} is recycled`,
          )
          return 1
        }
        console.log(
          `spawn: sandbox=${existing.id} is being recycled by the monitor, starting a new one`,
        )
        // The old sandbox is gone or retagged, so nothing else can serve this
        // worker id: if the replacement fails to create, the claim must be
        // released rather than kept.
        absenceConfirmed = true
        reuse = false
      }
    }
    if (reuse) {
      const state = await workerState(sandbox)
      if (state.state === "running") {
        await clearOwnMarker(sandbox, launchStamp)
        console.log(
          `spawn: worker already running pid=${state.pid} sandbox=${sandbox.id}`,
        )
        return 0
      }
    }
    if (!reuse) {
      sandbox = await createSandbox()
      created = true
      console.log(
        `spawn: created sandbox=${sandbox.id} template=${config.templateName} worker=${workerId}`,
      )
      // Two hook invocations for one worker id (a controller retry, or two
      // controller hosts) can both see no sandbox and both create one. The
      // oldest wins; a loser deletes its own sandbox and exits without
      // touching the claim, which the winner's worker is about to serve.
      const rivals = (
        await Sandbox.list({ metadata: { [META_WORKER_ID]: workerId } })
      ).filter((s) => LIVE_STATUSES.has(s.status))
      const winner = [...rivals].sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )[0]
      if (winner && winner.id !== sandbox.id) {
        console.log(
          `spawn: sandbox=${winner.id} already exists for worker=${workerId}; discarding ours`,
        )
        // Retag first so a controller retry can never select this sandbox
        // even if the delete fails, then delete it. A failure here is loud:
        // an unreachable loser is an operator problem, not a silent one.
        // The list call above already returned our own sandbox, tags and
        // all; retagging from that snapshot keeps cursor.managed and
        // cursor.pool intact so the monitor can still reap it if the
        // delete below fails.
        const ours =
          rivals.find((s) => s.id === sandbox.id) ?? (await sandbox.getInfo())
        try {
          if (!(await supersede(ours))) throw new Error("retag failed")
          await sandbox.kill()
        } catch (e) {
          console.error(
            `spawn: could not discard losing sandbox=${sandbox.id}: ${e.message}`,
          )
        }
        return 1
      }
    }

    const result = await launchWorker(sandbox, {
      pool,
      env: workerEnv({ workerId, workerName }),
    })
    if (!result.ok) {
      console.error(
        `spawn: worker failed to start sandbox=${sandbox.id} state=${result.state.state} ` +
          `exit=${result.state.exit_code ?? "-"}\n${result.log.slice(-2000)}`,
      )
      // Tear down first, then clear the marker: while it is set the monitor
      // leaves this sandbox alone, so it cannot delete the sandbox out from
      // under the teardown and strand the claim.
      await abandon(sandbox, created)
      if (!created) await clearOwnMarker(sandbox, launchStamp)
      return 1
    }
    if (!created) await clearOwnMarker(sandbox, launchStamp)

    console.log(
      `spawn: worker started pid=${result.pid} sandbox=${sandbox.id} pool=${pool} worker=${workerId}` +
        (requestId ? ` request=${requestId}` : ""),
    )
    return 0
  } catch (e) {
    console.error(`spawn: ${e.message}`)
    if (!sandbox && !absenceConfirmed) {
      console.error(
        `spawn: could not establish whether worker=${workerId} already runs; keeping the claim`,
      )
      return 1
    }
    await abandon(sandbox, created)
    if (sandbox && !created) await clearOwnMarker(sandbox, launchStamp)
    return 1
  }
}

// Serialize hook invocations for the same worker id on this host, so a
// controller retry cannot race a still-running spawn. The lock is a directory
// (atomic to create) with a stale timeout, and always removed on exit.
const LOCK_DIR = `${tmpdir()}/cursor-spawn-${workerId.replace(/[^A-Za-z0-9._-]/g, "_")}.lock`
const LOCK_STALE_MS = 10 * 60 * 1000
async function withWorkerLock(fn) {
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      mkdirSync(LOCK_DIR)
      break
    } catch (e) {
      if (e.code !== "EEXIST") throw e
      let age = 0
      try {
        age = Date.now() - statSync(LOCK_DIR).mtimeMs
      } catch {
        continue
      }
      if (age > LOCK_STALE_MS) {
        rmSync(LOCK_DIR, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline) {
        console.error(
          `spawn: another spawn for worker=${workerId} is still running; giving up`,
        )
        return 1
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(LOCK_DIR, { recursive: true, force: true })
  }
}

process.exit(await withWorkerLock(main))
