"""End-to-end tests for the AsyncSandbox variant.

The sync suite (`test_sandboxes.py`, `test_exec.py`, `test_files.py`) covers
each method individually. This test verifies `AsyncSandbox` is wired up
and shares semantics with `Sandbox`. Kept minimal to avoid duplicating coverage.
"""

import pytest

from superserve import AsyncSandbox

from _helpers import SKIP_IF_NO_CREDS

pytestmark = [SKIP_IF_NO_CREDS, pytest.mark.asyncio]


async def test_async_create_exec_delete(connection_opts, run_id):
    """Smoke-test the async client with a full create → exec → delete flow."""
    name = f"sdk-e2e-py-async-{run_id}"
    sandbox = await AsyncSandbox.create(name=name, **connection_opts)
    assert sandbox.id is not None

    try:
        result = await sandbox.commands.run("echo hello-async")
        assert "hello-async" in result.stdout
        assert result.exit_code == 0

        await sandbox.files.write("/tmp/async-probe.txt", b"async-data")
        content = await sandbox.files.read_text("/tmp/async-probe.txt")
        assert content == "async-data"
    finally:
        try:
            await sandbox.kill()
        except Exception as err:
            print(f"Cleanup failed for sandbox {sandbox.id}: {err}")
