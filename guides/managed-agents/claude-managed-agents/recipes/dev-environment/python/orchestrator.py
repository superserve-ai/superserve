"""Polling orchestrator for Claude Dev Environment Agent on Superserve."""

from __future__ import annotations

import asyncio
import fcntl
import json as _json
import logging
import os
import signal
import threading
import time
from pathlib import Path

import dotenv
from anthropic import AsyncAnthropic
from superserve import AsyncSandbox, NetworkConfig

dotenv.load_dotenv(override=True)

ENVIRONMENT_KEY = os.environ["ANTHROPIC_ENVIRONMENT_KEY"]
ENVIRONMENT_ID = os.environ["ANTHROPIC_ENVIRONMENT_ID"]
TEMPLATE_NAME = "claude-dev-environment"

# Sandboxes use a deny-by-default egress allowlist: only the hosts below are
# reachable, everything else is blocked (private IP ranges are always blocked
# by the platform regardless). The defaults cover the agent runtime, cloning
# from GitHub, and installing packages with npm and pip — the recipe's standard
# workflow. To reach other sources (GitLab, a private registry, an internal Git
# server), add those hosts here. To allow all public hosts instead, set
# ALLOWED_EGRESS = None (the network argument is omitted on create).
ALLOWED_EGRESS = [
    "api.anthropic.com",       # required: the in-sandbox runner talks to Anthropic
    "github.com",              # git clone over HTTPS
    "codeload.github.com",     # GitHub archive/tarball downloads
    "registry.npmjs.org",      # npm install
    "pypi.org",                # pip install
    "files.pythonhosted.org",  # pip package downloads
]

RUNNER = Path(__file__).with_name("runner.py").read_text()
RUNNER_PIDFILE = "/workspace/.runner.pid"
RUNNER_EXITFILE = "/workspace/.runner.exit"

log = logging.getLogger("orchestrator")
shutdown = asyncio.Event()
shutdown_thread = threading.Event()
_last_active: dict[str, float] = {}

IDLE_TIMEOUT = 300
JANITOR_INTERVAL = 60

META_SESSION_ID = "cma.session_id"
META_WORK_ID = "cma.work_id"
META_MODE = "cma.mode"
META_PAUSED_AT = "cma.paused_at"
MODE_ACTIVE = "active"

_lock_fd: int | None = None


def acquire_lock() -> None:
    global _lock_fd
    lock_path = Path(f"/tmp/superserve-cma-{ENVIRONMENT_ID}.lock")
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise RuntimeError(
            f"another orchestrator is already running for environment {ENVIRONMENT_ID}"
        ) from None
    os.ftruncate(fd, 0)
    os.write(fd, f"pid={os.getpid()} env={ENVIRONMENT_ID}\n".encode())
    _lock_fd = fd


RUNNER_PROBE_SCRIPT = f"""\
set +e
pidfile={RUNNER_PIDFILE}
exitfile={RUNNER_EXITFILE}

if test -f "$exitfile"; then
  code=$(head -n1 "$exitfile" 2>/dev/null | tr -d '[:space:]')
  printf '{{"state":"exited","pid":null,"exit_code":%s}}\\n' "${{code:-null}}"
  exit 0
fi

if ! test -s "$pidfile"; then
  printf '{{"state":"no_pidfile","pid":null,"exit_code":null}}\\n'
  exit 0
fi

pid=$(head -n1 "$pidfile" 2>/dev/null | tr -d '[:space:]')
if kill -0 "$pid" 2>/dev/null; then
  printf '{{"state":"running","pid":%s,"exit_code":null}}\\n' "$pid"
else
  printf '{{"state":"dead","pid":%s,"exit_code":null}}\\n' "$pid"
fi
"""

RUNNER_STOP_SCRIPT = f"""\
set +e
pidfile={RUNNER_PIDFILE}
exitfile={RUNNER_EXITFILE}

if test -s "$pidfile"; then
  pid=$(head -n1 "$pidfile" 2>/dev/null | tr -d '[:space:]')
  if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    if test -n "$pgid"; then
      kill -TERM "-$pgid" 2>/dev/null
    else
      kill -TERM "$pid" 2>/dev/null
    fi
    for i in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "-${{pgid:-$pid}}" 2>/dev/null
    fi
  fi
fi
rm -f "$pidfile" "$exitfile"
"""

RUNNER_LAUNCH_SCRIPT = f"""\
set -eu
cd /workspace
rm -f {RUNNER_PIDFILE} {RUNNER_EXITFILE}
setsid bash -c '
  python3 /workspace/runner.py
  code=$?
  printf "%s\\n" "$code" > {RUNNER_EXITFILE}
  exit "$code"
' > /workspace/runner.log 2>&1 < /dev/null &
pid=$!
printf "%s\\n" "$pid" > {RUNNER_PIDFILE}
echo "$pid"
"""


async def runner_state(sandbox: AsyncSandbox) -> dict:
    try:
        result = await sandbox.commands.run(RUNNER_PROBE_SCRIPT)
        lines = result.stdout.strip().splitlines()
        if lines:
            return _json.loads(lines[-1])
    except Exception:
        pass
    return {"state": "unknown", "pid": None, "exit_code": None}


async def stop_runner(sandbox: AsyncSandbox) -> None:
    try:
        await sandbox.commands.run(RUNNER_STOP_SCRIPT)
    except Exception as e:
        log.warning("failed to stop runner in sandbox=%s: %s", sandbox.id, e)


async def runner_alive(sandbox: AsyncSandbox) -> bool:
    return (await runner_state(sandbox))["state"] == "running"


async def fetch_runner_log(sandbox: AsyncSandbox) -> str:
    try:
        return await sandbox.files.read_text("/workspace/runner.log")
    except Exception as e:
        return f"(could not read runner.log: {e})"


async def update_metadata(sandbox: AsyncSandbox, **updates: str | None) -> None:
    info = await sandbox.get_info()
    meta = dict(info.metadata or {})
    for key, value in updates.items():
        if value is None:
            meta.pop(key, None)
        else:
            meta[key] = value
    await sandbox.update(metadata=meta)


async def find_or_create_sandbox(
    session_id: str,
    work_id: str,
    metadata: dict | None = None,
) -> AsyncSandbox:
    if metadata and metadata.get("superserve.sandbox_id"):
        sandbox_id = metadata["superserve.sandbox_id"]
        log.info("attaching prepared sandbox=%s for session=%s", sandbox_id, session_id)
        sandbox = await AsyncSandbox.connect(sandbox_id)
        if sandbox.status == "paused":
            await sandbox.resume()
        await update_metadata(
            sandbox,
            **{
                META_SESSION_ID: session_id,
                META_WORK_ID: work_id,
                META_MODE: MODE_ACTIVE,
                META_PAUSED_AT: None,
            },
        )
        return sandbox

    existing = await AsyncSandbox.list(metadata={META_SESSION_ID: session_id})
    live = [s for s in existing if s.status in ("active", "paused")]

    if live:
        sandbox = await AsyncSandbox.connect(live[0].id)
        if live[0].status == "paused":
            log.info("resuming sandbox=%s for session=%s", live[0].id, session_id)
            await sandbox.resume()
        await update_metadata(
            sandbox,
            **{META_WORK_ID: work_id, META_MODE: MODE_ACTIVE, META_PAUSED_AT: None},
        )
        return sandbox

    log.info("creating sandbox for session=%s", session_id)
    return await AsyncSandbox.create(
        name=f"cma-{session_id[:8]}",
        from_template=TEMPLATE_NAME,
        metadata={
            META_SESSION_ID: session_id,
            META_WORK_ID: work_id,
            META_MODE: MODE_ACTIVE,
        },
        network=NetworkConfig(allow_out=ALLOWED_EGRESS) if ALLOWED_EGRESS else None,
    )


async def handle_work(work) -> None:
    session_id = work.data.id
    log.info("claimed work=%s session=%s", work.id, session_id)

    session_metadata = getattr(work.data, "metadata", None)
    sandbox = await find_or_create_sandbox(session_id, work.id, session_metadata)

    state = await runner_state(sandbox)
    if state["state"] == "running":
        log.info("runner already alive pid=%s in sandbox=%s", state["pid"], sandbox.id)
        _last_active[session_id] = time.monotonic()
        return

    await stop_runner(sandbox)
    await sandbox.files.write("/workspace/runner.py", RUNNER)
    result = await sandbox.commands.run(
        RUNNER_LAUNCH_SCRIPT,
        env={
            "ANTHROPIC_ENVIRONMENT_KEY": ENVIRONMENT_KEY,
            "ANTHROPIC_WORK_ID": work.id,
            "ANTHROPIC_SESSION_ID": session_id,
            "ANTHROPIC_ENVIRONMENT_ID": ENVIRONMENT_ID,
        },
    )

    try:
        launched_pid = int(result.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        runner_log = await fetch_runner_log(sandbox)
        log.error(
            "runner launch did not report PID sandbox=%s\n%s",
            sandbox.id,
            runner_log[:500],
        )
        return

    await asyncio.sleep(2)
    state = await runner_state(sandbox)
    if state["state"] not in ("running", "exited") or (
        state["state"] == "exited" and state["exit_code"] != 0
    ):
        runner_log = await fetch_runner_log(sandbox)
        log.error(
            "runner failed sandbox=%s pid=%s state=%s exit=%s\n%s",
            sandbox.id,
            launched_pid,
            state["state"],
            state.get("exit_code"),
            runner_log[:500],
        )
        return

    _last_active[session_id] = time.monotonic()
    log.info(
        "runner started pid=%s sandbox=%s session=%s",
        launched_pid,
        sandbox.id,
        session_id,
    )


async def janitor_loop() -> None:
    while not shutdown.is_set():
        try:
            await asyncio.wait_for(shutdown.wait(), timeout=JANITOR_INTERVAL)
            return
        except TimeoutError:
            pass

        try:
            sandboxes = await AsyncSandbox.list()
            now = time.monotonic()

            for s in sandboxes:
                if s.status != "active":
                    continue
                session_id = (s.metadata or {}).get(META_SESSION_ID)
                if not session_id:
                    continue
                if now - _last_active.get(session_id, 0) < IDLE_TIMEOUT:
                    continue

                try:
                    sandbox = await AsyncSandbox.connect(s.id)
                    if await runner_alive(sandbox):
                        _last_active[session_id] = now
                        continue
                    log.info("pausing idle sandbox=%s session=%s", s.id, session_id)
                    await update_metadata(
                        sandbox,
                        **{
                            META_PAUSED_AT: time.strftime(
                                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                            )
                        },
                    )
                    await sandbox.pause()
                except Exception as e:
                    log.warning("janitor: sandbox=%s error: %s", s.id, e)
        except Exception as e:
            log.warning("janitor error: %s", e)


async def poll_loop() -> None:
    backoff = 0
    async with AsyncAnthropic(auth_token=ENVIRONMENT_KEY) as client:
        log.info("polling env=%s template=%s", ENVIRONMENT_ID, TEMPLATE_NAME)

        while not shutdown.is_set():
            try:
                async for work in client.beta.environments.work.poller(
                    environment_id=ENVIRONMENT_ID,
                    environment_key=ENVIRONMENT_KEY,
                    block_ms=999,
                    reclaim_older_than_ms=2000,
                    auto_stop=False,
                ):
                    backoff = 0
                    try:
                        await handle_work(work)
                    except Exception as e:
                        log.error("failed work=%s: %s", work.id, e, exc_info=True)
            except Exception as e:
                backoff = min(backoff + 1, 6)
                wait = min(60.0, 2.0**backoff)
                log.warning("poll error, retrying in %.0fs: %s", wait, e)
                try:
                    await asyncio.wait_for(shutdown.wait(), timeout=wait)
                    return
                except TimeoutError:
                    pass


def main() -> None:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    acquire_lock()

    loop = asyncio.new_event_loop()

    def request_shutdown(signum, _frame):
        log.info("shutdown requested (signal %d)", signum)
        shutdown_thread.set()
        loop.call_soon_threadsafe(shutdown.set)

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    async def run():
        async with asyncio.TaskGroup() as tg:
            tg.create_task(poll_loop())
            tg.create_task(janitor_loop())

    loop.run_until_complete(run())


if __name__ == "__main__":
    main()
