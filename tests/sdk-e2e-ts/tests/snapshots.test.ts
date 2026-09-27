import { Sandbox, Snapshot } from "@superserve/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

// A counter the forks must carry on from, not start over.
const START_COUNTER =
  "nohup sh -c 'i=0; while true; do i=$((i+1)); echo $i > /tmp/counter; sleep 0.2; done' >/dev/null 2>&1 &"

async function counter(sandbox: Sandbox): Promise<number> {
  const result = await sandbox.commands.run("cat /tmp/counter")
  return Number(result.stdout.trim())
}

describe.skipIf(!hasCredentials())("snapshots", () => {
  const opts = hasCredentials()
    ? connectionOptions()
    : { apiKey: "", baseUrl: "" }
  const created: Sandbox[] = []
  const snapshots: Snapshot[] = []
  let source: Sandbox

  beforeAll(async () => {
    source = await Sandbox.create({ name: `sdk-e2e-snap-${RUN_ID}`, ...opts })
    created.push(source)
    await source.files.write("/tmp/marker.txt", "from-the-source")
    await source.commands.run(START_COUNTER)
  })

  afterAll(async () => {
    for (const snapshot of snapshots) {
      await snapshot.delete().catch((err) => console.error(err))
    }
    for (const sandbox of created) {
      await sandbox.kill().catch((err) => console.error(err))
    }
  })

  async function forkAndCheck(
    snapshot: Snapshot,
    label: string,
    atCapture: number,
  ) {
    for (const n of [1, 2]) {
      const fork = await Sandbox.create({
        name: `sdk-e2e-fork-${label}-${n}-${RUN_ID}`,
        fromSnapshot: snapshot,
        ...opts,
      })
      created.push(fork)
      expect((await fork.getInfo()).sourceSnapshotId).toBe(snapshot.id)
      expect(await fork.files.readText("/tmp/marker.txt")).toBe(
        "from-the-source",
      )
      const first = await counter(fork)
      expect(first).toBeGreaterThanOrEqual(atCapture)
      await new Promise((r) => setTimeout(r, 1_000))
      expect(await counter(fork)).toBeGreaterThan(first)
    }
  }

  it("forks a running sandbox with its files and processes", async () => {
    const atCapture = await counter(source)
    const snapshot = await source.snapshot({ name: `running-${RUN_ID}` })
    snapshots.push(snapshot)
    expect(snapshot.status).toBe("ready")
    expect(snapshot.sandboxId).toBe(source.id)
    await forkAndCheck(snapshot, "running", atCapture)
  }, 300_000)

  it("forks a paused sandbox", async () => {
    await source.pause({ wait: true })
    const snapshot = await source.snapshot({ name: `paused-${RUN_ID}` })
    snapshots.push(snapshot)
    await forkAndCheck(snapshot, "paused", 0)
  }, 300_000)

  it("lists, renames and deletes", async () => {
    const listed = await source.snapshots()
    expect(listed.map((s) => s.id)).toEqual(
      expect.arrayContaining(snapshots.map((s) => s.id)),
    )
    const renamed = await snapshots[0].rename(`renamed-${RUN_ID}`)
    expect(renamed.name).toBe(`renamed-${RUN_ID}`)

    const last = snapshots.pop()!
    await last.delete()
    const after = await source.snapshots()
    expect(after.map((s) => s.id)).not.toContain(last.id)
  })

  it("leaves the source able to resume", async () => {
    await source.resume()
    expect((await source.getInfo()).status).toBe("active")
    expect(await source.files.readText("/tmp/marker.txt")).toBe(
      "from-the-source",
    )
  })
})
