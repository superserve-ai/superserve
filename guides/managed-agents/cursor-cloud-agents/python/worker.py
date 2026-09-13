"""Shared helpers for the spawn hook and the monitor.

Sandbox tagging, the in-sandbox worker supervisor scripts, and the Cursor
pool API.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shlex
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import dotenv
from superserve import Sandbox, SandboxInfo

# Load .env next to the scripts, not from the controller's cwd. Variables the
# controller already set (CURSOR_POOL, CURSOR_AGENT_WORKER_ID, ...) win:
# load_dotenv never overrides existing values.
dotenv.load_dotenv(Path(__file__).with_name(".env"))

META_MANAGED = "cursor.managed"
META_WORKER_ID = "cursor.worker_id"
META_POOL = "cursor.pool"
META_REQUEST_ID = "cursor.request_id"
META_REPO = "cursor.repo"
# Set by the spawn hook while it resumes and relaunches a paused sandbox, so the
# monitor leaves it alone until the new worker is up (see MONITOR_GRACE_SECONDS).
META_LAUNCHING = "cursor.launching"
# Set by the monitor while it pauses or deletes a sandbox; the spawn hook
# treats a fresh marker as "not mine to reuse" and starts a new sandbox.
META_RECYCLING = "cursor.recycling"

STATE_DIR = "/var/lib/cursor-worker"
PIDFILE = f"{STATE_DIR}/worker.pid"
EXITFILE = f"{STATE_DIR}/worker.exit"
LOGFILE = f"{STATE_DIR}/worker.log"

STARTUP_GRACE_SECONDS = 5
LIVE_STATUSES = ("starting", "active", "pausing", "paused", "resuming")


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "")
    if raw == "":
        return default
    return raw in ("true", "1")


TEMPLATE_NAME = os.environ.get("CURSOR_WORKER_TEMPLATE", "cursor-worker")
IDLE_RELEASE_TIMEOUT = os.environ.get("CURSOR_WORKER_IDLE_RELEASE_TIMEOUT", "600")
CLONE_GIT_REPOS = _flag("CURSOR_WORKER_CLONE_GIT_REPOS", True)
HIBERNATE = _flag("CURSOR_WORKER_HIBERNATE", False)
AUTO_DELETE_SECONDS = int(os.environ.get("SANDBOX_AUTO_DELETE_SECONDS", "86400"))
# Sandboxes resolve DNS through these public resolvers. A strict allowlist has
# to include them or nothing resolves. Single IPs are written as /32.
# A strict allowlist still needs the sandbox's resolvers, or nothing resolves.
# The SDK reaches the sandbox through the platform, not through its network,
# so no Superserve host needs to be allowed.
DNS_RESOLVERS = ["1.1.1.1/32", "8.8.8.8/32"]
_IPV4_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def egress_allowlist(raw: str) -> list[str]:
    entries = [e.strip() for e in raw.split(",") if e.strip()]
    entries = [f"{e}/32" if _IPV4_RE.match(e) else e for e in entries]
    if not entries:
        return []
    return list(dict.fromkeys(DNS_RESOLVERS + entries))


ALLOW_OUT = egress_allowlist(os.environ.get("CURSOR_WORKER_ALLOW_OUT", ""))
CURSOR_ENDPOINT = os.environ.get("CURSOR_API_ENDPOINT", "https://api.cursor.com")


def _render(script: str) -> str:
    return (
        script.replace("__STATE_DIR__", STATE_DIR)
        .replace("__PIDFILE__", PIDFILE)
        .replace("__EXITFILE__", EXITFILE)
        .replace("__LOGFILE__", LOGFILE)
    )


PROBE_SCRIPT = _render(
    """\
#!/bin/bash
set +e
if test -f "__EXITFILE__"; then
  code=$(head -n1 "__EXITFILE__" 2>/dev/null | tr -d '[:space:]')
  printf '{"state":"exited","pid":null,"exit_code":%s}\\n' "${code:-null}"
  exit 0
fi
if ! test -s "__PIDFILE__"; then
  printf '{"state":"no_pidfile","pid":null,"exit_code":null}\\n'
  exit 0
fi
pid=$(head -n1 "__PIDFILE__" 2>/dev/null | tr -d '[:space:]')
# The launcher runs the worker under setsid, so the recorded pid is also the
# process group id. The group counts as running while any member is alive,
# even if the leader has already gone.
if kill -0 "$pid" 2>/dev/null || pgrep -g "$pid" >/dev/null 2>&1; then
  printf '{"state":"running","pid":%s,"exit_code":null}\\n' "$pid"
else
  printf '{"state":"dead","pid":%s,"exit_code":null}\\n' "$pid"
fi
"""
)

STOP_SCRIPT = _render(
    """\
#!/bin/bash
set +e
# Same critical section as launch.sh: a stop and a launch never interleave,
# so a launch cannot lose its fresh pid file to a concurrent stop.
exec 9>"__STATE_DIR__/launch.lock"
flock -w 30 9 || { echo "stop: could not acquire lock" >&2; exit 1; }
if test -s "__PIDFILE__"; then
  pid=$(head -n1 "__PIDFILE__" 2>/dev/null | tr -d '[:space:]')
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
rm -f "__PIDFILE__" "__EXITFILE__"
"""
)

# The worker runs detached from the exec session (setsid) so it outlives the
# API call that started it. The command itself lives in run.sh so no shell
# quoting is involved; the exit code lands in EXITFILE for the probe.
RUNFILE = f"{STATE_DIR}/run.sh"
LAUNCH_SCRIPT = _render(
    """\
#!/bin/bash
set -eu
export HOME="${HOME:-/root}"
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
mkdir -p "__STATE_DIR__" /workspace
cd /workspace
# Serialize launches: the check below and the start after it must be one
# critical section, or two launchers can both see no live pid and start two
# workers. The lock is held by this script only (the worker closes fd 9).
exec 9>"__STATE_DIR__/launch.lock"
flock -w 30 9 || { echo "launch: could not acquire lock" >&2; exit 1; }
# Idempotent: if a worker is already running, report its pid and leave it
# alone, so two launchers racing on one sandbox can never start two workers.
if test -s "__PIDFILE__"; then
  existing=$(head -n1 "__PIDFILE__" 2>/dev/null | tr -d '[:space:]')
  # Match the probe: the group counts as live while any member is alive,
  # even if the setsid leader has already gone.
  if test -n "$existing" && { kill -0 "$existing" 2>/dev/null || pgrep -g "$existing" >/dev/null 2>&1; }; then
    if test -f "__EXITFILE__"; then
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
rm -f "__PIDFILE__" "__EXITFILE__"
# Before reporting the exit, reap anything a task left behind in the worker's
# process group, so a written exit file always means the group is empty.
setsid bash -c 'bash "__RUNFILE__"; code=$?; stragglers=$(pgrep -g $$ | grep -vx $$ || true); [ -n "$stragglers" ] && kill -KILL $stragglers 2>/dev/null; printf "%s\\n" "$code" > "__EXITFILE__"' > "__LOGFILE__" 2>&1 < /dev/null 9>&- &
pid=$!
printf "%s\\n" "$pid" > "__PIDFILE__"
echo "$pid"
"""
).replace("__RUNFILE__", RUNFILE)


def run_script(command: str) -> str:
    return f"#!/bin/bash\nexec {command}\n"


def worker_command(pool: str) -> str:
    """Build the worker command for run.sh. The pool name is shell-quoted so
    any name Cursor accepts is passed through intact."""
    if not pool:
        raise ValueError("pool name is required")
    args = ["agent", "worker", "--pool", shlex.quote(pool)]
    if CLONE_GIT_REPOS:
        args.append("--clone-git-repos")
    args.append("start")
    return " ".join(args)


def worker_env(worker_id: str, worker_name: str | None = None) -> dict[str, str]:
    """Env for the worker process.

    CURSOR_API_KEY is set on this command rather than sandbox-wide, but the
    agent's commands share the worker's user and can still read it: scope the
    service account to the pool.
    """
    env = {
        "CURSOR_AGENT_WORKER_ID": worker_id,
        "CURSOR_WORKER_IDLE_RELEASE_TIMEOUT": IDLE_RELEASE_TIMEOUT,
    }
    env["CURSOR_API_KEY"] = os.environ["CURSOR_API_KEY"]
    if worker_name:
        env["CURSOR_WORKER_NAME"] = worker_name
    for key in ("CURSOR_API_URL", "CURSOR_API_ENDPOINT"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


def status_of(info: SandboxInfo | Sandbox) -> str:
    return getattr(info.status, "value", str(info.status))


# A missing probe script is reported as its own state: the spawn hook died
# after creating the sandbox but before installing the supervisor, and nothing
# will ever start a worker there.
PROBE_COMMAND = (
    f"if test -f {STATE_DIR}/probe.sh; then bash {STATE_DIR}/probe.sh; "
    'else printf \'{"state":"no_supervisor","pid":null,"exit_code":null}\\n\'; fi'
)


def worker_state(sandbox: Sandbox) -> dict[str, Any]:
    try:
        result = sandbox.commands.run(PROBE_COMMAND)
        lines = result.stdout.strip().splitlines()
        if lines:
            return json.loads(lines[-1])
    except Exception:
        pass
    return {"state": "unknown", "pid": None, "exit_code": None}


def stop_worker(sandbox: Sandbox) -> None:
    """Stop the worker's whole process group.

    Raises when any member survives, so callers never release a claim over a
    worker that is still alive.
    """
    result = sandbox.commands.run(f"bash {STATE_DIR}/stop.sh")
    if result.exit_code != 0:
        raise RuntimeError(
            f"stop failed: {(result.stderr or '').strip() or f'exit {result.exit_code}'}"
        )


def read_log(sandbox: Sandbox) -> str:
    try:
        return sandbox.files.read_text(LOGFILE)
    except Exception as e:
        return f"(could not read {LOGFILE}: {e})"


def launch_worker(
    sandbox: Sandbox, pool: str, env: dict[str, str], command: str | None = None
) -> dict[str, Any]:
    """Start the worker detached. ``command`` overrides the worker command; tests
    use it to run a stand-in process."""
    sandbox.commands.run(f"mkdir -p {STATE_DIR}")
    sandbox.files.write(f"{STATE_DIR}/launch.sh", LAUNCH_SCRIPT)
    sandbox.files.write(RUNFILE, run_script(command or worker_command(pool)))
    sandbox.files.write(f"{STATE_DIR}/probe.sh", PROBE_SCRIPT)
    sandbox.files.write(f"{STATE_DIR}/stop.sh", STOP_SCRIPT)

    result = sandbox.commands.run(f"bash {STATE_DIR}/launch.sh", env=env)
    try:
        pid = int(result.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        return {
            "ok": False,
            "state": {"state": "no_pidfile", "pid": None, "exit_code": None},
            "log": read_log(sandbox),
        }

    time.sleep(STARTUP_GRACE_SECONDS)
    state = worker_state(sandbox)
    if state["state"] != "running":
        return {"ok": False, "state": state, "log": read_log(sandbox)}
    return {"ok": True, "pid": pid, "state": state}


def clear_own_marker(sandbox: Sandbox, stamp: str) -> None:
    """Remove the relaunch marker only if it is still the one this attempt wrote.

    Marker ownership is per attempt: a concurrent launcher may have replaced it
    with a newer stamp, and that marker must survive until its owner clears it.
    One read, one write from that same snapshot: the check and the removal
    must not be separated by a second read that could see a newer marker.
    """
    try:
        metadata = dict(sandbox.get_info().metadata)
        if metadata.get(META_LAUNCHING) != stamp:
            return
        metadata.pop(META_LAUNCHING, None)
        Sandbox.update_by_id(sandbox.id, metadata=metadata)
    except Exception:
        pass  # best effort; the marker expires with the grace period anyway


def tag_sandbox(sandbox: Sandbox, updates: dict[str, str | None]) -> None:
    """Merge metadata updates into the sandbox's tags; None removes a key.

    update() replaces the whole map, so read first.
    """
    metadata = dict(sandbox.get_info().metadata or {})
    for key, value in updates.items():
        if value is None:
            metadata.pop(key, None)
        else:
            metadata[key] = value
    sandbox.update(metadata=metadata)


def find_sandbox_for_worker(worker_id: str) -> SandboxInfo | None:
    matches = Sandbox.list(metadata={META_WORKER_ID: worker_id})
    for info in matches:
        if status_of(info) in LIVE_STATUSES:
            return info
    return None


# --- Cursor pool API (service-account key, Basic auth) ----------------------


def cursor_api(path: str, method: str = "GET", body: Any | None = None) -> Any:
    token = base64.b64encode(f"{os.environ['CURSOR_API_KEY']}:".encode()).decode()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{CURSOR_ENDPOINT}{path}", data=data, method=method)
    req.add_header("Authorization", f"Basic {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> {e.code} {detail}") from None
    return json.loads(raw) if raw else None


def release_claim(request_id: str, attempts: int = 4) -> Any:
    """Hand a claimed request back to the queue when the worker could not start.

    Retried with backoff: a claim that stays attached to a worker that will
    never connect sits idle until Cursor expires it. If every attempt fails,
    the error names the request so the release can be done by hand.
    """
    path = (
        f"/v0/private-workers/claims/{urllib.parse.quote(request_id, safe='')}/release"
    )
    last_error: Exception | None = None
    for i in range(attempts):
        try:
            return cursor_api(path, method="POST")
        except Exception as e:
            last_error = e
            if i < attempts - 1:
                time.sleep(2**i)
    raise RuntimeError(
        f"release of request={request_id} failed after {attempts} attempts "
        f"({last_error}); release it manually: POST {CURSOR_ENDPOINT}{path}"
    )


def list_pending_requests(pool: str | None) -> list[dict[str, Any]]:
    requests: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        params: dict[str, str] = {"limit": "100"}
        if pool:
            params["pool"] = pool
        if page_token:
            params["pageToken"] = page_token
        page = cursor_api(
            f"/v0/private-workers/pending-requests?{urllib.parse.urlencode(params)}"
        )
        requests.extend((page or {}).get("requests", []))
        page_token = (page or {}).get("nextPageToken")
        if not page_token:
            return requests
