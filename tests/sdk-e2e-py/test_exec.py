import pytest

from superserve import Sandbox

from _helpers import SKIP_IF_NO_CREDS

pytestmark = SKIP_IF_NO_CREDS


@pytest.fixture(scope="module")
def sandbox(connection_opts, run_id):
    name = f"sdk-e2e-py-exec-{run_id}"
    sbx = Sandbox.create(name=name, **connection_opts)
    yield sbx
    try:
        sbx.kill()
    except Exception as err:
        print(f"Cleanup failed for sandbox {sbx.id}: {err}")


def test_command_returns_stdout_and_exit_code(sandbox):
    result = sandbox.commands.run("echo hello-from-e2e")
    assert "hello-from-e2e" in result.stdout
    assert result.exit_code == 0


def test_command_returns_non_zero_exit_code(sandbox):
    result = sandbox.commands.run("exit 42")
    assert result.exit_code == 42


def test_command_stream_with_callbacks(sandbox):
    stdout_chunks = []

    result = sandbox.commands.run(
        "for i in 1 2 3; do echo line-$i; sleep 0.1; done",
        on_stdout=lambda data: stdout_chunks.append(data),
    )

    combined = "".join(stdout_chunks)
    assert "line-1" in combined
    assert "line-2" in combined
    assert "line-3" in combined
    assert result.exit_code == 0
