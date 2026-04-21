import pytest

from superserve import Sandbox

from _helpers import SKIP_IF_NO_CREDS

pytestmark = SKIP_IF_NO_CREDS


@pytest.fixture(scope="module")
def sandbox(connection_opts, run_id):
    name = f"sdk-e2e-py-sandbox-{run_id}"
    sbx = Sandbox.create(name=name, **connection_opts)
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


def test_pause_and_resume_lifecycle(sandbox, connection_opts):
    sandbox.pause()
    info = Sandbox.get(sandbox.id, **connection_opts)
    assert info.status.value == "paused"

    sandbox.resume()
    info = Sandbox.get(sandbox.id, **connection_opts)
    assert info.status.value == "active"
