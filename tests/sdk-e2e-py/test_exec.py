import pytest

from _helpers import SKIP_IF_NO_CREDS, wait_for_status

pytestmark = SKIP_IF_NO_CREDS


@pytest.fixture(scope="module")
def sandbox(client, run_id):
    name = f"sdk-e2e-py-exec-{run_id}"
    sbx = client.sandboxes.create_sandbox(name=name)
    assert sbx.id is not None
    wait_for_status(client, sbx.id, "active")
    yield sbx
    try:
        client.sandboxes.delete_sandbox(sbx.id)
    except Exception as err:
        print(f"Cleanup failed for sandbox {sbx.id}: {err}")


def test_command_returns_stdout_and_exit_code(client, sandbox):
    result = client.exec.command(sandbox.id, command="echo hello-from-e2e")
    assert "hello-from-e2e" in (result.stdout or "")
    assert result.exit_code == 0


def test_command_returns_non_zero_exit_code(client, sandbox):
    result = client.exec.command(sandbox.id, command="exit 42")
    assert result.exit_code == 42


def test_command_stream_yields_events_and_finishes(client, sandbox):
    events = list(
        client.exec.command_stream(
            sandbox.id,
            command="for i in 1 2 3; do echo line-$i; sleep 0.1; done",
        )
    )

    stdout_chunks = [e.stdout for e in events if e.stdout]
    combined = "".join(stdout_chunks)
    assert "line-1" in combined
    assert "line-2" in combined
    assert "line-3" in combined

    finished_events = [e for e in events if e.finished]
    assert len(finished_events) >= 1
    assert finished_events[-1].exit_code == 0
