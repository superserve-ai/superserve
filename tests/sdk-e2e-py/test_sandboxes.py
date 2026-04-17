import time

import pytest

from superserve import Sandbox

from _helpers import SKIP_IF_NO_CREDS

pytestmark = SKIP_IF_NO_CREDS


@pytest.fixture(scope="module")
def sandbox(connection_opts, run_id):
    name = f"sdk-e2e-py-sandbox-{run_id}"
    sbx = Sandbox.create(name=name, **connection_opts)
    sbx.wait_for_ready()
    yield sbx
    try:
        sbx.kill()
    except Exception as err:
        print(f"Cleanup failed for sandbox {sbx.id}: {err}")


def test_get_sandbox_returns_created(sandbox):
    result = sandbox.get_info()
    assert result.id == sandbox.id
    assert result.name == sandbox.name
    assert result.status.value == "active"


def test_list_sandboxes_includes_ours(sandbox, connection_opts):
    sandboxes = Sandbox.list(**connection_opts)
    ids = [s.id for s in sandboxes]
    assert sandbox.id in ids


def test_update_accepts_metadata(sandbox, run_id):
    sandbox.update(metadata={"env": "test", "run-id": run_id})
    result = sandbox.get_info()
    assert result.id == sandbox.id


def test_pause_and_resume_lifecycle(sandbox):
    sandbox.pause()
    # Backend may return "paused" or "idle" depending on version — spec drift.
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        info = sandbox.get_info()
        if info.status.value in ("paused", "idle"):
            break
        time.sleep(2)
    assert sandbox.status.value in ("paused", "idle")

    sandbox.resume()
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        info = sandbox.get_info()
        if info.status.value == "active":
            break
        time.sleep(2)
    assert sandbox.status.value == "active"
