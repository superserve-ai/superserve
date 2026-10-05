"""--spawn hook for `agent worker controller`.

Runs once per claimed request (or once per missing warm worker) with CURSOR_*
set by the controller. Creates a Superserve sandbox and starts a Cursor pool
worker inside it.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

from superserve import ConflictError, NetworkConfig, Sandbox, SandboxInfo
from worker import (
    ALLOW_OUT,
    AUTO_DELETE_SECONDS,
    META_LAUNCHING,
    META_MANAGED,
    META_POOL,
    META_RECYCLING,
    META_REPO,
    META_REQUEST_ID,
    META_WORKER_ID,
    TEMPLATE_NAME,
    clear_own_marker,
    find_sandbox_for_worker,
    launch_worker,
    release_claim,
    status_of,
    stop_worker,
    tag_sandbox,
    worker_env,
    worker_state,
)

# Must match the monitor's MONITOR_GRACE_SECONDS: markers older than this are stale.
LIVE_STATUSES = ("starting", "active", "pausing", "paused", "resuming")
GRACE_SECONDS = int(os.environ.get("MONITOR_GRACE_SECONDS", "120"))


# Probe states that confirm no worker is running; anything else (including a
# transient probe failure) is inconclusive and must not release a claim.
STOPPED_STATES = ("exited", "dead", "no_pidfile")


def log(message: str) -> None:
    print(f"spawn: {message}", flush=True)


def err(message: str) -> None:
    print(f"spawn: {message}", file=sys.stderr, flush=True)


def sandbox_name(worker_id: str) -> str:
    short = re.sub(r"[^a-z0-9]", "", worker_id.lower())[:12]
    return f"cursor-{short or 'worker'}"


def create_sandbox(
    worker_id: str, pool: str, request_id: str | None, repo: str | None
) -> Sandbox:
    metadata = {META_MANAGED: "true", META_WORKER_ID: worker_id, META_POOL: pool}
    if request_id:
        metadata[META_REQUEST_ID] = request_id
    if repo:
        metadata[META_REPO] = repo

    network = None
    if ALLOW_OUT:
        network = NetworkConfig(allow_out=ALLOW_OUT, deny_out=["0.0.0.0/0"])

    return Sandbox.create(
        name=sandbox_name(worker_id),
        from_template=TEMPLATE_NAME,
        metadata=metadata,
        auto_delete_seconds=AUTO_DELETE_SECONDS,
        network=network,
    )


def supersede(info: SandboxInfo) -> bool:
    """Retag a sandbox the monitor is recycling so it can no longer be found by
    worker id: with hibernation on it may be paused rather than deleted, and a
    replacement is about to be created under the same id.

    Returns False if the tag could not be written: without it the monitor
    cannot tell the old sandbox from a live one, so no replacement may be
    created on top of it.
    """
    try:
        Sandbox.update_by_id(
            info.id,
            metadata={
                **{k: v for k, v in info.metadata.items() if k != META_LAUNCHING},
                META_WORKER_ID: f"{info.metadata.get(META_WORKER_ID)}.superseded",
            },
        )
        return True
    except Exception as e:
        err(f"could not mark sandbox={info.id} as superseded: {e}")
        return False


def replacement_exists(worker_id: str, exclude_id: str) -> bool:
    """True when another live sandbox carries this worker id (a replacement
    spawn has taken over the request). Inconclusive lookups count as "exists"
    so a claim is never released on a guess."""
    if not worker_id:
        return False
    try:
        return any(
            s.id != exclude_id and status_of(s) in LIVE_STATUSES
            for s in Sandbox.list(metadata={META_WORKER_ID: worker_id})
        )
    except Exception as e:
        err(f"could not check for a replacement of worker={worker_id}: {e}")
        return True


def abandon(sandbox: Sandbox | None, created: bool, request_id: str | None) -> bool:
    """Tear down whatever this spawn started, then hand the request back.

    The release comes last and only once the worker is confirmed gone:
    releasing first would let Cursor reassign the request while a worker that
    survived a transient probe failure keeps serving it. If teardown fails, the
    claim is kept and the failure is loud rather than silently doubled.
    """
    if sandbox is not None:
        try:
            if created:
                sandbox.kill()
            else:
                stop_worker(sandbox)
                after = worker_state(sandbox)
                if after["state"] not in STOPPED_STATES:
                    raise RuntimeError(
                        f"worker state={after['state']} not confirmed stopped"
                    )
        except Exception as e:
            # If the sandbox is already gone (the monitor recycled it in the
            # window between our marker write and its own, which whole-map
            # metadata updates cannot exclude), there is no worker left to
            # serve the request: treat that as torn down and release below.
            try:
                worker_id = (
                    sandbox.metadata.get(META_WORKER_ID) if sandbox.metadata else None
                )
                live = (
                    Sandbox.list(metadata={META_WORKER_ID: worker_id})
                    if worker_id
                    else []
                )
                gone = not any(
                    s.id == sandbox.id and status_of(s) != "deleted" for s in live
                )
            except Exception:
                gone = False
            if not gone:
                what = "delete sandbox" if created else "stop worker in sandbox"
                suffix = f" request={request_id}" if request_id else ""
                err(f"could not {what}={sandbox.id}: {e}; keeping the claim{suffix}")
                return False
            err(f"sandbox={sandbox.id} is already gone ({e}); treating it as torn down")
    if request_id:
        # A retry on another host may have created a replacement for this
        # worker id in the meantime; its worker is about to serve the request,
        # so the claim must stay put.
        worker_id = os.environ.get("CURSOR_AGENT_WORKER_ID", "")
        if replacement_exists(worker_id, sandbox.id if sandbox is not None else ""):
            err(
                f"a replacement for worker={worker_id} exists; leaving request={request_id} claimed"
            )
            return True
        try:
            release_claim(request_id)
            err(f"released claim request={request_id}")
            # A released request must not be released again by a later sweep.
            if sandbox is not None and not created:
                try:
                    tag_sandbox(sandbox, {META_REQUEST_ID: None})
                except Exception:
                    pass
        except Exception as e:
            err(f"could not release claim request={request_id}: {e}")
    return True


def main() -> int:
    for key in (
        "SUPERSERVE_API_KEY",
        "CURSOR_API_KEY",
        "CURSOR_AGENT_WORKER_ID",
        "CURSOR_POOL",
    ):
        if not os.environ.get(key):
            err(f"{key} is not set")
            return 2

    worker_id = os.environ["CURSOR_AGENT_WORKER_ID"]
    pool = os.environ["CURSOR_POOL"]
    request_id = os.environ.get("CURSOR_REQUEST_ID") or None
    worker_name = os.environ.get("CURSOR_WORKER_NAME") or None
    owner, name = (
        os.environ.get("CURSOR_REPO_OWNER"),
        os.environ.get("CURSOR_REPO_NAME"),
    )
    repo = f"{owner}/{name}" if owner and name else None

    sandbox: Sandbox | None = None
    created = False
    # Set once we know no other sandbox can be serving this worker id. Until
    # then a failure must keep the claim: releasing it while a live worker may
    # exist would let Cursor run the request twice.
    absence_confirmed = False
    # Identifies this attempt's relaunch marker so cleanup never removes another's.
    launch_stamp = str(int(time.time() * 1000))
    try:
        # A paused sandbox tagged with this worker id is a hibernated workspace
        # (see the monitor). Resume it instead of starting from scratch.
        existing = find_sandbox_for_worker(worker_id)
        reuse = existing is not None
        if existing is None:
            absence_confirmed = True
        if reuse:
            log(
                f"reusing sandbox={existing.id} status={status_of(existing)} worker={worker_id}"
            )
            # Tell the monitor a relaunch is in progress before anything resumes
            # the sandbox: connect() auto-resumes, and the previous worker's exit
            # file is visible the moment it does.
            try:
                Sandbox.update_by_id(
                    existing.id,
                    metadata={
                        **(existing.metadata or {}),
                        META_LAUNCHING: launch_stamp,
                        **({META_REQUEST_ID: request_id} if request_id else {}),
                    },
                )
            except Exception as e:
                # Nothing has been touched yet, and the existing worker may be
                # live or mid-resume by the monitor: keep the claim rather than
                # release a request that sandbox may be about to serve.
                err(
                    f"could not mark sandbox={existing.id} for relaunch ({e}); "
                    "keeping the claim"
                )
                return 1
            # Re-read after marking: if the monitor is pausing or deleting this
            # sandbox right now, it is not ours to reuse. Start a fresh one.
            recheck = next(
                (
                    s
                    for s in Sandbox.list(metadata={META_WORKER_ID: worker_id})
                    if s.id == existing.id
                ),
                None,
            )
            recycling_ms = int(
                (recheck.metadata if recheck else {}).get(META_RECYCLING) or 0
            )
            if recheck is None or (
                recycling_ms and time.time() - recycling_ms / 1000 < GRACE_SECONDS
            ):
                if recheck is not None and not supersede(recheck):
                    err(
                        "keeping the claim; the controller can retry once "
                        f"sandbox={existing.id} is recycled"
                    )
                    return 1
                log(
                    f"sandbox={existing.id} is being recycled by the monitor, starting a new one"
                )
                # The old sandbox is gone or retagged, so nothing else can serve
                # this worker id: if the replacement fails to create, the claim
                # must be released rather than kept.
                absence_confirmed = True
                reuse = False
        if reuse:
            # The monitor's wake path may be resuming this same sandbox, or its
            # sweep may be recycling it. Either shows up here as a conflict.
            try:
                sandbox = Sandbox.connect(existing.id)
                if status_of(sandbox) == "paused":
                    sandbox.resume()
            except Exception as e:
                # The relaunch marker is left in place: marker ownership and
                # activation ownership are independent, so a stamp check cannot
                # tell whether the winner's marker is the one stored. Whoever
                # completes the launch clears it, and it expires with the grace
                # period regardless.
                if not isinstance(e, ConflictError):
                    # A transport failure may have lost the activation response
                    # while the sandbox came up anyway, possibly with a live
                    # worker. Release only once a probe confirms nothing is
                    # running there; otherwise keep the claim and let the
                    # controller retry.
                    err(f"could not resume sandbox={existing.id}: {e}")
                    try:
                        probed_sandbox = Sandbox.connect(existing.id)
                        probed = worker_state(probed_sandbox)
                    except Exception as probe_err:
                        err(
                            f"sandbox={existing.id} unreachable for a probe "
                            f"({probe_err}); keeping the claim"
                        )
                        return 1
                    if probed["state"] == "running":
                        err(
                            f"worker pid={probed['pid']} is running in "
                            f"sandbox={existing.id}; keeping the claim"
                        )
                        return 1
                    if probed["state"] == "unknown":
                        err(
                            f"worker state in sandbox={existing.id} is inconclusive; "
                            "keeping the claim"
                        )
                        return 1
                    # Hand the probed sandbox to the teardown so it is recognized
                    # as ours (and not mistaken for a replacement) when the claim
                    # is released.
                    abandon(probed_sandbox, False, request_id)
                    return 1
                # Re-read to tell the two apart. A wake in progress is about to
                # serve the request, so keep the claim for it. A recycle in
                # progress means nothing will serve it there, so start a
                # replacement.
                now = next(
                    (
                        s
                        for s in Sandbox.list(metadata={META_WORKER_ID: worker_id})
                        if s.id == existing.id
                    ),
                    None,
                )
                recycling_ms = int(
                    (now.metadata if now else {}).get(META_RECYCLING) or 0
                )
                if now is not None and not (
                    recycling_ms and time.time() - recycling_ms / 1000 < GRACE_SECONDS
                ):
                    err(
                        f"sandbox={existing.id} is being resumed by another launcher "
                        f"({e}); keeping the claim"
                    )
                    return 1
                if now is not None and not supersede(now):
                    err(
                        "keeping the claim; the controller can retry once "
                        f"sandbox={existing.id} is recycled"
                    )
                    return 1
                log(
                    f"sandbox={existing.id} is being recycled by the monitor, starting a new one"
                )
                # The old sandbox is gone or retagged, so nothing else can serve
                # this worker id: if the replacement fails to create, the claim
                # must be released rather than kept.
                absence_confirmed = True
                reuse = False
        if reuse:
            state = worker_state(sandbox)
            if state["state"] == "running":
                clear_own_marker(sandbox, launch_stamp)
                log(f"worker already running pid={state['pid']} sandbox={sandbox.id}")
                return 0
        if not reuse:
            sandbox = create_sandbox(worker_id, pool, request_id, repo)
            created = True
            log(
                f"created sandbox={sandbox.id} template={TEMPLATE_NAME} worker={worker_id}"
            )
            # Two hook invocations for one worker id (a controller retry, or two
            # controller hosts) can both see no sandbox and both create one. The
            # oldest wins; a loser deletes its own sandbox and exits without
            # touching the claim, which the winner's worker is about to serve.
            rivals = [
                s
                for s in Sandbox.list(metadata={META_WORKER_ID: worker_id})
                if status_of(s) in LIVE_STATUSES
            ]
            rivals.sort(key=lambda s: (s.created_at, s.id))
            if rivals and rivals[0].id != sandbox.id:
                log(
                    f"sandbox={rivals[0].id} already exists for worker={worker_id}; "
                    "discarding ours"
                )
                # Retag first so a controller retry can never select this sandbox
                # even if the delete fails, then delete it. A failure here is loud:
                # an unreachable loser is an operator problem, not a silent one.
                try:
                    Sandbox.update_by_id(
                        sandbox.id,
                        metadata={
                            **(sandbox.metadata or {}),
                            META_WORKER_ID: f"{worker_id}.superseded",
                        },
                    )
                    sandbox.kill()
                except Exception as e:
                    err(f"could not discard losing sandbox={sandbox.id}: {e}")
                return 1

        result = launch_worker(sandbox, pool, worker_env(worker_id, worker_name))
        if not result["ok"]:
            state = result["state"]
            err(
                f"worker failed to start sandbox={sandbox.id} state={state.get('state')} "
                f"exit={state.get('exit_code', '-')}\n{result['log'][-2000:]}"
            )
            # Tear down first, then clear the marker: while it is set the
            # monitor leaves this sandbox alone, so it cannot delete the
            # sandbox out from under the teardown and strand the claim.
            abandon(sandbox, created, request_id)
            if not created:
                clear_own_marker(sandbox, launch_stamp)
            return 1
        if not created:
            clear_own_marker(sandbox, launch_stamp)

        suffix = f" request={request_id}" if request_id else ""
        log(
            f"worker started pid={result['pid']} sandbox={sandbox.id} "
            f"pool={pool} worker={worker_id}{suffix}"
        )
        return 0
    except Exception as e:
        err(str(e))
        if sandbox is None and not absence_confirmed:
            err(
                f"could not establish whether worker={worker_id} already runs; keeping the claim"
            )
            return 1
        abandon(sandbox, created, request_id)
        if sandbox is not None and not created:
            clear_own_marker(sandbox, launch_stamp)
        return 1


def with_worker_lock(fn):
    """Serialize hook invocations for the same worker id on this host, so a
    controller retry cannot race a still-running spawn. The lock is a directory
    (atomic to create) with a stale timeout, and always removed on exit."""
    worker_id = os.environ.get("CURSOR_AGENT_WORKER_ID", "")
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", worker_id)
    lock_dir = Path(tempfile.gettempdir()) / f"cursor-spawn-{safe}.lock"
    deadline = time.time() + 60
    while True:
        try:
            lock_dir.mkdir()
            break
        except FileExistsError:
            try:
                age = time.time() - lock_dir.stat().st_mtime
            except FileNotFoundError:
                continue
            if age > 600:
                shutil.rmtree(lock_dir, ignore_errors=True)
                continue
            if time.time() > deadline:
                err(f"another spawn for worker={worker_id} is still running; giving up")
                return 1
            time.sleep(0.5)
    try:
        return fn()
    finally:
        shutil.rmtree(lock_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(with_worker_lock(main))
