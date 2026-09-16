"""Long-running janitor for worker sandboxes.

When a worker exits (idle release, crash, or manual stop) the sandbox is
deleted, or paused when CURSOR_WORKER_HIBERNATE=true. In hibernate mode it
also watches the pool's pending requests and resumes a paused sandbox when
Cursor asks for its worker again (a claimed-but-offline entry with that
worker id).
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from superserve import Sandbox, SandboxInfo
from worker import (
    HIBERNATE,
    META_LAUNCHING,
    META_MANAGED,
    META_POOL,
    META_RECYCLING,
    META_REQUEST_ID,
    META_WORKER_ID,
    TEMPLATE_NAME,
    clear_own_marker,
    launch_worker,
    list_pending_requests,
    release_claim,
    status_of,
    stop_worker,
    tag_sandbox,
    worker_env,
    worker_state,
)

log = logging.getLogger("monitor")

# Probe states that confirm no worker is running; anything else (including a
# transient probe failure) is inconclusive and must not release a claim.
STOPPED_STATES = ("exited", "dead", "no_pidfile")
TERMINAL_STATES = ("exited", "dead", "no_pidfile", "no_supervisor")
ONCE = "--once" in sys.argv[1:]
POLL_SECONDS = int(os.environ.get("MONITOR_POLL_SECONDS", "15"))
WAKE_CONCURRENCY = int(os.environ.get("MONITOR_WAKE_CONCURRENCY", "4"))
GRACE_SECONDS = int(os.environ.get("MONITOR_GRACE_SECONDS", "120"))
POOL = os.environ.get("CURSOR_POOL") or None
WAKE_ENABLED = HIBERNATE

shutdown = threading.Event()
waking: set[str] = set()


def claimed_request_for(
    worker_id: str | None, fallback: str | None
) -> tuple[bool, str | None]:
    """The request a worker is currently serving, resolved live from Cursor's
    queue: warm workers are created without a request tag, and a hibernated
    sandbox may have been retagged since. Falls back to the creation-time tag.

    Returns (ok, request_id); ok is False when the lookup itself failed, so
    callers can defer a destructive step instead of proceeding on a guess.
    """
    if not worker_id or not os.environ.get("CURSOR_API_KEY"):
        return True, fallback
    try:
        for request in list_pending_requests(POOL):
            if request.get("claimedWorkerId") == worker_id:
                return True, request.get("id") or fallback
        return True, fallback
    except Exception as e:
        log.warning("could not look up the claim for worker=%s: %s", worker_id, e)
        return False, None


LIVE_STATUSES = ("starting", "active", "pausing", "paused", "resuming")


def replacement_exists(worker_id: str | None, exclude_id: str) -> bool:
    """True when another live sandbox now carries this worker id: a replacement
    spawn has taken over the request, and releasing its claim would strand it.
    Checked immediately before every release, after the old sandbox is gone."""
    if not worker_id:
        return False
    try:
        # Only a sandbox that can still run a worker counts. A failed or
        # deleted record can never serve the claim, so it must not suppress
        # the release.
        return any(
            s.id != exclude_id and status_of(s) in LIVE_STATUSES
            for s in Sandbox.list(metadata={META_WORKER_ID: worker_id})
        )
    except Exception as e:
        log.warning("could not check for a replacement of worker=%s: %s", worker_id, e)
        return True  # inconclusive: do not release


def recycle(info: SandboxInfo) -> None:
    sandbox = Sandbox.connect(info.id)
    state = worker_state(sandbox)
    # Only act on confirmed terminal states. An inconclusive probe (transient
    # exec error, malformed output) is retried on the next sweep.
    if state["state"] not in TERMINAL_STATES:
        if state["state"] != "running":
            log.warning(
                "sandbox=%s probe inconclusive (%s), retrying next sweep",
                info.id,
                state["state"],
            )
        return

    # `info` is a snapshot from the sweep's list call. A spawn hook may have
    # marked this sandbox for relaunch since; re-read before acting so the
    # recycle never races a relaunch that is already under way.
    current = sandbox.get_info().metadata
    launching_ms = int(current.get(META_LAUNCHING) or 0)
    if launching_ms and time.time() - launching_ms / 1000 < GRACE_SECONDS:
        log.info("sandbox=%s marked for relaunch, leaving it alone", info.id)
        return
    # Metadata has no compare-and-swap, so ownership is claimed by writing a
    # marker and re-reading: a spawn hook that marks the sandbox for relaunch
    # in the same window sees our marker and starts a fresh sandbox instead,
    # and if its marker landed first we back off here. What remains is the
    # width of one round-trip, and the launch lock keeps even that from
    # starting two workers.
    Sandbox.update_by_id(
        info.id, metadata={**current, META_RECYCLING: str(int(time.time() * 1000))}
    )
    recheck = sandbox.get_info().metadata
    launching_ms = int(recheck.get(META_LAUNCHING) or 0)
    # Probe again now that ownership is recorded: a relaunch that slipped in
    # between the first probe and the marker write shows up here as a live
    # worker, even if its marker was lost to the whole-map write above.
    state_now = worker_state(sandbox)
    relaunched = (
        state_now["state"] == "running" or state_now["state"] not in TERMINAL_STATES
    )
    if (
        launching_ms and time.time() - launching_ms / 1000 < GRACE_SECONDS
    ) or relaunched:
        try:
            Sandbox.update_by_id(
                info.id,
                metadata={k: v for k, v in recheck.items() if k != META_RECYCLING},
            )
        except Exception:
            pass
        log.info("sandbox=%s claimed for relaunch during recycle, backing off", info.id)
        return

    detail = (
        f"state={state['state']} exit={state.get('exit_code', '-')} "
        f"worker={info.metadata.get(META_WORKER_ID)}"
    )
    # With hibernation on, a sandbox whose worker was stopped deliberately (no
    # pid file left behind, e.g. after a failed relaunch) still holds a
    # workspace a follow-up may want: pause it like any other exited worker.
    # Only a sandbox that never got a supervisor, or one without hibernation,
    # is reclaimed outright.
    abandoned = state["state"] == "no_supervisor" or (
        state["state"] == "no_pidfile" and not HIBERNATE
    )
    if abandoned:
        # No worker ever ran here, or it was stopped deliberately: the spawn
        # hook died before installing the supervisor or before the launch
        # wrote a pid. Past the grace period nothing will start one, so reclaim
        # the sandbox outright.
        # Read the tags one last time right before the kill: a retried spawn
        # that saw our recycle marker supersedes this sandbox and starts a
        # replacement for the same request, and that request must then stay
        # claimed for the replacement rather than be released here.
        try:
            latest = sandbox.get_info().metadata
        except Exception:
            latest = recheck
        superseded = str(latest.get(META_WORKER_ID) or "").endswith(".superseded")
        log.info("deleting abandoned sandbox=%s %s", info.id, detail)
        sandbox.kill()
        # Otherwise the request it was claimed for has no worker and never
        # will; hand it back so it can be served elsewhere instead of waiting
        # for Cursor to expire the claim.
        request_id = None if superseded else latest.get(META_REQUEST_ID)
        if superseded:
            log.info(
                "sandbox=%s was superseded by a replacement; leaving its claim alone",
                info.id,
            )
        if request_id and replacement_exists(
            info.metadata.get(META_WORKER_ID), info.id
        ):
            log.info(
                "a replacement sandbox now serves worker=%s; leaving request=%s claimed",
                info.metadata.get(META_WORKER_ID),
                request_id,
            )
            return
        if request_id and os.environ.get("CURSOR_API_KEY"):
            try:
                release_claim(request_id)
                log.info("released claim request=%s", request_id)
            except Exception as e:
                log.error("%s", e)
        return
    if HIBERNATE:
        log.info("pausing sandbox=%s %s", info.id, detail)
        sandbox.pause(wait=True)
        # The paused sandbox is reusable again; drop the ownership marker.
        # Merge into the metadata as it is now, not the pre-pause snapshot: a
        # spawn that overlapped the pause may have retagged this sandbox.
        try:
            latest = sandbox.get_info().metadata
            Sandbox.update_by_id(
                info.id,
                metadata={k: v for k, v in latest.items() if k != META_RECYCLING},
            )
        except Exception as e:
            log.warning("could not clear recycle marker on sandbox=%s: %s", info.id, e)
    else:
        # A clean idle exit (code 0) was already freed by Cursor. Anything else
        # is a crash: the request it was serving is still claimed by a worker
        # that no longer exists, so hand it back after the delete.
        crashed = state["state"] == "dead" or (state.get("exit_code") or 0) != 0
        try:
            latest = sandbox.get_info().metadata
        except Exception:
            latest = recheck
        superseded = str(latest.get(META_WORKER_ID) or "").endswith(".superseded")
        # Resolve the claim before the delete: once the sandbox is gone there
        # is nothing left to retry from. An inconclusive lookup defers the
        # recycle to the next sweep rather than orphaning the request.
        request_id = None
        if crashed and not superseded:
            ok, request_id = claimed_request_for(
                latest.get(META_WORKER_ID), latest.get(META_REQUEST_ID)
            )
            if not ok:
                log.warning(
                    "deferring recycle of sandbox=%s until its claim can be resolved",
                    info.id,
                )
                return
        log.info("deleting sandbox=%s %s", info.id, detail)
        sandbox.kill()
        if request_id and replacement_exists(
            info.metadata.get(META_WORKER_ID), info.id
        ):
            log.info(
                "a replacement sandbox now serves worker=%s; leaving request=%s claimed",
                info.metadata.get(META_WORKER_ID),
                request_id,
            )
            return
        if request_id and os.environ.get("CURSOR_API_KEY"):
            try:
                release_claim(request_id)
                log.info("released claim request=%s after worker crash", request_id)
            except Exception as e:
                log.error("%s", e)


def reap_failed(info: SandboxInfo) -> None:
    worker_id = info.metadata.get(META_WORKER_ID)
    superseded = str(worker_id or "").endswith(".superseded")
    # Resolve the claim before deleting: once the sandbox is gone nothing can
    # retry an inconclusive lookup, so an outage here defers to the next sweep.
    request_id = None
    if not superseded:
        ok, request_id = claimed_request_for(
            worker_id, info.metadata.get(META_REQUEST_ID)
        )
        if not ok:
            log.warning(
                "claim lookup for failed sandbox=%s inconclusive, retrying next sweep",
                info.id,
            )
            return
    log.info("deleting failed sandbox=%s worker=%s", info.id, worker_id)
    Sandbox.kill_by_id(info.id)
    if not request_id:
        return
    if replacement_exists(worker_id, info.id):
        log.info(
            "a replacement for worker=%s exists, leaving request=%s claimed",
            worker_id,
            request_id,
        )
        return
    try:
        release_claim(request_id)
        log.info("released claim request=%s after sandbox failure", request_id)
    except Exception as e:
        log.error("%s", e)


def sweep() -> list[SandboxInfo]:
    # Scope to this monitor's pool so parallel pool deployments never touch
    # each other's sandboxes.
    sandboxes = Sandbox.list(metadata={META_MANAGED: "true", META_POOL: POOL or ""})
    now = datetime.now(UTC)
    for info in sandboxes:
        if status_of(info) == "failed":
            # A sandbox that failed to boot or resume never auto-deletes (that
            # only applies to paused ones) and its worker is gone for good:
            # drop the record and hand back whatever request it was claimed for.
            try:
                reap_failed(info)
            except Exception as e:
                log.warning("failed sandbox=%s error: %s", info.id, e)
            continue
        if status_of(info) != "active":
            continue
        # Give a freshly spawned sandbox time to bring its worker up.
        created_at = info.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        if (now - created_at).total_seconds() < GRACE_SECONDS:
            continue
        # The spawn hook stamps a resumed sandbox while it relaunches the worker;
        # its created_at is old, so give the relaunch the same grace.
        launching_ms = int(info.metadata.get(META_LAUNCHING) or 0)
        if launching_ms and time.time() - launching_ms / 1000 < GRACE_SECONDS:
            continue
        if info.id in waking:
            continue
        try:
            recycle(info)
        except Exception as e:
            log.warning("sandbox=%s error: %s", info.id, e)
    return sandboxes


def wake_one(info: SandboxInfo, request: dict) -> None:
    worker_id = request["claimedWorkerId"]
    waking.add(info.id)
    try:
        log.info(
            "waking sandbox=%s worker=%s request=%s window=%ss",
            info.id,
            worker_id,
            request.get("id"),
            round((request.get("wakeTimeoutMs") or 0) / 1000),
        )
        # The spawn hook may be reviving this same worker if the controller
        # re-ran it for the follow-up. Check its marker through a list lookup,
        # which leaves a paused sandbox paused; connect() would resume it and
        # race the hook's own resume. The launch script holds a lock as well,
        # so whatever slips through here still cannot start two workers.
        fresh = next(
            (
                s
                for s in Sandbox.list(metadata={META_WORKER_ID: worker_id})
                if s.id == info.id
            ),
            None,
        )
        if fresh is None:
            return
        launching_ms = int(fresh.metadata.get(META_LAUNCHING) or 0)
        if launching_ms and time.time() - launching_ms / 1000 < GRACE_SECONDS:
            log.info(
                "sandbox=%s is being launched by the spawn hook, skipping wake", info.id
            )
            return
        # Retag with the follow-up's request id: if the relaunch fails, the
        # sweep must release this request, not the one the sandbox was created for.
        stamp = str(int(time.time() * 1000))
        Sandbox.update_by_id(
            info.id,
            metadata={
                **fresh.metadata,
                META_LAUNCHING: stamp,
                META_REQUEST_ID: request["id"],
            },
        )
        try:
            sandbox = Sandbox.connect(info.id)
        except Exception:
            # The marker must not outlive a failed activation, or the next
            # sweeps would skip this sandbox for the whole grace period. Clear
            # only the marker this attempt wrote, from a fresh read: a spawn
            # hook that won the activation has its own newer marker and
            # request id in there.
            try:
                # Read through the list endpoint: connect() would activate the
                # sandbox, and a resumed sandbox with no worker is exactly what
                # this path must not leave behind.
                now = next(
                    (
                        s.metadata
                        for s in Sandbox.list(metadata={META_WORKER_ID: worker_id})
                        if s.id == info.id
                    ),
                    None,
                )
                if now is not None and now.get(META_LAUNCHING) == stamp:
                    Sandbox.update_by_id(
                        info.id,
                        metadata={k: v for k, v in now.items() if k != META_LAUNCHING},
                    )
            except Exception:
                pass  # best effort; the marker expires with the grace period anyway
            raise
        try:
            if status_of(sandbox) == "paused":
                sandbox.resume()
            pool = info.metadata.get(META_POOL) or POOL or ""
            result = launch_worker(sandbox, pool, worker_env(worker_id))
            if result["ok"]:
                log.info(
                    "worker resumed pid=%s sandbox=%s worker=%s",
                    result["pid"],
                    info.id,
                    worker_id,
                )
            else:
                log.error(
                    "worker failed to resume sandbox=%s state=%s\n%s",
                    info.id,
                    result["state"].get("state"),
                    result["log"][-2000:],
                )
                # A confirmed failed wake must not leave the follow-up parked
                # on a worker that cannot serve it. Stop anything that
                # survived, confirm it is gone, then hand the request back; the
                # next sweep recycles the sandbox as usual.
                try:
                    # A controller spawn may have started relaunching this
                    # sandbox after our launch attempt failed. Check that
                    # before touching anything: its marker means the worker in
                    # there (or about to be) is not ours to stop, and the
                    # request is spoken for.
                    def owned_by_another() -> bool:
                        marker = sandbox.get_info().metadata.get(META_LAUNCHING)
                        return bool(
                            marker
                            and marker != stamp
                            and time.time() - int(marker) / 1000 < GRACE_SECONDS
                        )

                    if owned_by_another():
                        raise RuntimeError(
                            "another launcher has marked this sandbox; "
                            "leaving it and the claim to it"
                        )
                    # stop.sh takes the launch lock, so a launch cannot
                    # interleave with the stop and lose its pid file.
                    stop_worker(sandbox)
                    after = worker_state(sandbox)
                    if after["state"] not in STOPPED_STATES:
                        raise RuntimeError(
                            f"worker state={after['state']} not confirmed stopped"
                        )
                    # Re-validate immediately before releasing.
                    if owned_by_another():
                        raise RuntimeError(
                            "another launcher has marked this sandbox; leaving the claim to it"
                        )
                    again = worker_state(sandbox)
                    if again["state"] == "running":
                        raise RuntimeError(
                            f"worker pid={again['pid']} started meanwhile; leaving the claim"
                        )
                    release_claim(request["id"])
                    log.info("released claim request=%s", request["id"])
                    # A released request must not be released again by a later sweep.
                    tag_sandbox(sandbox, {META_REQUEST_ID: None})
                except Exception as e:
                    log.error("could not release request=%s: %s", request["id"], e)
        finally:
            clear_own_marker(sandbox, stamp)
    finally:
        waking.discard(info.id)


def wake(sandboxes: list[SandboxInfo]) -> None:
    paused = {
        s.metadata[META_WORKER_ID]: s
        for s in sandboxes
        if status_of(s) == "paused" and s.metadata.get(META_WORKER_ID)
    }
    if not paused:
        return

    pending = []
    for request in list_pending_requests(POOL):
        info = paused.get(request.get("claimedWorkerId") or "")
        if info is None or info.id in waking:
            continue
        pending.append((info, request))
    if not pending:
        return

    # Each wake waits out the worker's startup probe, so a burst of follow-ups
    # would otherwise revive one sandbox at a time and eat into every request's
    # reconnect window. Run them in bounded parallel; sandboxes are independent.
    def run(item: tuple[SandboxInfo, dict]) -> None:
        info, request = item
        try:
            wake_one(info, request)
        except Exception as e:
            log.error("wake sandbox=%s error: %s", info.id, e)

    with ThreadPoolExecutor(max_workers=min(WAKE_CONCURRENCY, len(pending))) as pool_:
        list(pool_.map(run, pending))


def main() -> int:
    logging.basicConfig(
        level="INFO", format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    for key in ("SUPERSERVE_API_KEY", "CURSOR_API_KEY"):
        # Both are required: without the Cursor key the monitor could neither
        # wake hibernated workers nor release the claims of crashed ones, and
        # would fail those requests silently instead of loudly here.
        if not os.environ.get(key):
            print(f"monitor: {key} is not set", file=sys.stderr)
            return 2
    if not POOL:
        # Without a pool the sweep would cover every worker sandbox on the team,
        # including other pools' hibernated workers.
        print("monitor: CURSOR_POOL is not set", file=sys.stderr)
        return 2

    def request_shutdown(signum, _frame):
        log.info("shutdown requested (signal %d)", signum)
        shutdown.set()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    log.info(
        "watching template=%s hibernate=%s wake=%s%s every %ss",
        TEMPLATE_NAME,
        HIBERNATE,
        WAKE_ENABLED,
        f" pool={POOL}",
        POLL_SECONDS,
    )
    while not shutdown.is_set():
        try:
            sandboxes = sweep()
            if WAKE_ENABLED:
                wake(sandboxes)
        except Exception as e:
            log.warning("%s", e)
        if ONCE:
            break
        shutdown.wait(POLL_SECONDS)
    log.info("stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
