import pytest

from _helpers import SKIP_IF_NO_CREDS, wait_for_status

pytestmark = SKIP_IF_NO_CREDS


@pytest.fixture(scope="module")
def sandbox(client, run_id):
    """Module-scoped: one sandbox shared across all tests in this file.

    Created in `beforeAll`-style, deleted in teardown even if tests fail.
    Orphans (from crashes before teardown) carry the run_id suffix in
    their name for manual cleanup.
    """
    name = f"sdk-e2e-py-sandbox-{run_id}"
    sbx = client.sandboxes.create_sandbox(name=name)
    assert sbx.id is not None
    wait_for_status(client, sbx.id, "active")
    yield sbx
    try:
        client.sandboxes.delete_sandbox(sbx.id)
    except Exception as err:
        # Non-fatal: log and let the test run finish.
        print(f"Cleanup failed for sandbox {sbx.id}: {err}")


def test_get_sandbox_returns_created(client, sandbox):
    result = client.sandboxes.get_sandbox(sandbox.id)
    assert result.id == sandbox.id
    assert result.name == sandbox.name
    assert result.status == "active"


def test_list_sandboxes_includes_ours(client, sandbox):
    sandboxes = client.sandboxes.list_sandboxes()
    ids = [s.id for s in sandboxes]
    assert sandbox.id in ids


def test_patch_sandbox_accepts_metadata(client, sandbox, run_id):
    # The API may or may not echo metadata back on GET; we verify the
    # patch call itself succeeds and the sandbox is still reachable.
    client.sandboxes.patch_sandbox(
        sandbox.id,
        metadata={"env": "test", "run-id": run_id},
    )
    result = client.sandboxes.get_sandbox(sandbox.id)
    assert result.id == sandbox.id


def test_pause_and_resume_lifecycle(client, sandbox):
    client.sandboxes.pause_sandbox(sandbox.id)
    paused = wait_for_status(client, sandbox.id, "idle", timeout_s=90)
    assert paused.status == "idle"

    client.sandboxes.resume_sandbox(sandbox.id)
    resumed = wait_for_status(client, sandbox.id, "active", timeout_s=90)
    assert resumed.status == "active"
