import { describe, expect, test } from "bun:test"

import { apiError, json, runCli, SANDBOX_ID } from "./harness"

const SNAP_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const snap = (status: string) => ({
  id: SNAP_ID,
  sandbox_id: SANDBOX_ID,
  kind: "mem+fs",
  status,
  name: "with-deps",
  size_bytes: 0,
  resources: { vcpu_count: 2, memory_mib: 2048, disk_mib: 4096 },
  created_at: "2026-01-01T00:00:00Z",
})

describe("snapshot", () => {
  test("create sends name and key, then polls a 202 until it fails", async () => {
    const r = await runCli(
      [
        "snapshot",
        "create",
        SANDBOX_ID,
        "--name",
        "with-deps",
        "--idempotency-key",
        "k1",
      ],
      {
        fetch: (req) =>
          req.method === "POST"
            ? json(snap("creating"), 202)
            : json(snap("failed")),
      },
    )
    expect(r.requests[0].url.pathname).toBe(`/sandboxes/${SANDBOX_ID}/snapshot`)
    expect(r.requests[0].json()).toEqual({
      name: "with-deps",
      idempotency_key: "k1",
    })
    expect(r.requests[1].url.pathname).toBe(`/snapshots/${SNAP_ID}`)
    expect(r.exitCode).toBe(1)
  })

  test("create --no-wait returns the creating snapshot", async () => {
    const r = await runCli(
      ["snapshot", "create", SANDBOX_ID, "--no-wait", "--json"],
      {
        fetch: () => json(snap("creating"), 202),
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests).toHaveLength(1)
    expect(JSON.parse(r.stdout).status).toBe("creating")
  })

  test("delete needs --yes; 202 and 404 both count as deleted", async () => {
    const refused = await runCli(["snapshot", "delete", SNAP_ID])
    expect(refused.exitCode).toBe(2)
    expect(refused.requests).toHaveLength(0)

    const other = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    const r = await runCli(["snapshot", "rm", SNAP_ID, other, "-y"], {
      fetch: (req) =>
        req.url.pathname.endsWith(SNAP_ID)
          ? json({ status: "deleting" }, 202)
          : apiError(404, "not_found", "gone"),
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests.map((q) => q.method)).toEqual(["DELETE", "DELETE"])
  })

  test("a non-UUID snapshot ID is a usage error, not a request", async () => {
    const r = await runCli(["snapshot", "get", "with-deps"])
    expect(r.exitCode).toBe(2)
    expect(r.requests).toHaveLength(0)
  })
})

describe("snapshot output", () => {
  test("a snapshot without resources still prints", async () => {
    const id = "33333333-3333-4333-8333-333333333333"
    const r = await runCli(["snapshot", "get", id], {
      fetch: () =>
        json({ id, name: "s", status: "creating", sandbox_id: SANDBOX_ID }),
    })
    expect(r.exitCode).toBe(0)
  })
})
