import pytest

from _helpers import SKIP_IF_NO_CREDS, async_wait_for_status

pytestmark = SKIP_IF_NO_CREDS


@pytest.mark.asyncio
async def test_async_create_exec_delete(async_client, run_id):
    """Smoke-test the async client with a full create → exec → delete flow.

    The sync tests (`test_sandboxes.py`, `test_exec.py`) cover every method
    individually. This test verifies `AsyncSuperserve` is wired up and
    shares semantics with `Superserve`. Kept minimal to avoid duplicating
    coverage.
    """
    name = f"sdk-e2e-py-async-{run_id}"
    sandbox = await async_client.sandboxes.create_sandbox(name=name)
    assert sandbox.id is not None

    await async_wait_for_status(async_client, sandbox.id, "active")

    try:
        result = await async_client.exec.command(
            sandbox.id, command="echo hello-async"
        )
        assert "hello-async" in (result.stdout or "")
        assert result.exit_code == 0
    finally:
        try:
            await async_client.sandboxes.delete_sandbox(sandbox.id)
        except Exception as err:
            print(f"Cleanup failed for sandbox {sandbox.id}: {err}")
