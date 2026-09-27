import time

import pytest

from superserve import Sandbox, Snapshot

from _helpers import SKIP_IF_NO_CREDS

pytestmark = SKIP_IF_NO_CREDS

# A counter the forks must carry on from, not start over.
START_COUNTER = (
    "nohup sh -c 'i=0; while true; do i=$((i+1)); echo $i > /tmp/counter; "
    "sleep 0.2; done' >/dev/null 2>&1 &"
)


def counter(sandbox: Sandbox) -> int:
    return int(sandbox.commands.run("cat /tmp/counter").stdout.strip())


@pytest.fixture(scope="module")
def state(connection_opts, run_id):
    source = Sandbox.create(name=f"sdk-e2e-py-snap-{run_id}", **connection_opts)
    source.files.write("/tmp/marker.txt", "from-the-source")
    source.commands.run(START_COUNTER)
    st = {"source": source, "created": [source], "snapshots": []}
    yield st
    for snapshot in st["snapshots"]:
        try:
            snapshot.delete()
        except Exception as err:
            print(f"Cleanup failed for snapshot {snapshot.id}: {err}")
    for sandbox in st["created"]:
        try:
            sandbox.kill()
        except Exception as err:
            print(f"Cleanup failed for sandbox {sandbox.id}: {err}")


def fork_and_check(
    state, snapshot: Snapshot, label: str, at_capture: int, opts, run_id
):
    for n in (1, 2):
        fork = Sandbox.create(
            name=f"sdk-e2e-py-fork-{label}-{n}-{run_id}",
            from_snapshot=snapshot,
            **opts,
        )
        state["created"].append(fork)
        assert fork.get_info().source_snapshot_id == snapshot.id
        assert fork.files.read_text("/tmp/marker.txt") == "from-the-source"
        first = counter(fork)
        assert first >= at_capture
        time.sleep(1)
        assert counter(fork) > first


def test_fork_a_running_sandbox(state, connection_opts, run_id):
    source = state["source"]
    at_capture = counter(source)
    snapshot = source.snapshot(name=f"running-{run_id}")
    state["snapshots"].append(snapshot)
    assert snapshot.status.value == "ready"
    assert snapshot.sandbox_id == source.id
    fork_and_check(state, snapshot, "running", at_capture, connection_opts, run_id)


def test_fork_a_paused_sandbox(state, connection_opts, run_id):
    source = state["source"]
    source.pause(wait=True)
    snapshot = source.snapshot(name=f"paused-{run_id}")
    state["snapshots"].append(snapshot)
    fork_and_check(state, snapshot, "paused", 0, connection_opts, run_id)


def test_list_rename_delete(state, run_id):
    source = state["source"]
    listed = {s.id for s in source.snapshots()}
    assert {s.id for s in state["snapshots"]} <= listed

    renamed = state["snapshots"][0].rename(f"renamed-{run_id}")
    assert renamed.name == f"renamed-{run_id}"

    last = state["snapshots"].pop()
    last.delete()
    assert last.id not in {s.id for s in source.snapshots()}


def test_source_resumes(state):
    source = state["source"]
    source.resume()
    assert source.get_info().status.value == "active"
    assert source.files.read_text("/tmp/marker.txt") == "from-the-source"
