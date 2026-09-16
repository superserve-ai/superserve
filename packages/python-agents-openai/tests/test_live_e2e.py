import io
import os
import tempfile
from pathlib import Path

import pytest
from agents.sandbox import SandboxPathGrant
from agents.sandbox.entries import LocalDir
from agents.sandbox.manifest import Manifest
from superserve_agents_openai import SuperserveSandboxClient
from superserve_agents_openai.client import SuperserveSandboxSessionState

pytestmark = pytest.mark.skipif(
    not os.environ.get("SUPERSERVE_API_KEY"),
    reason="SUPERSERVE_API_KEY environment variable not set",
)


@pytest.mark.asyncio
async def test_live_superserve_sandbox_lifecycle():
    client = SuperserveSandboxClient()
    manifest = Manifest(root="/workspace")
    session = await client.create(manifest=manifest)
    assert isinstance(session.state, SuperserveSandboxSessionState)
    assert session.state.sandbox_id is not None

    try:
        async with session:
            # 1. Verify running status
            is_running = await session.running()
            assert is_running is True

            # 2. Command execution
            result = await session.exec("echo hello-live-superserve")
            assert result.exit_code == 0
            assert b"hello-live-superserve" in result.stdout

            # 3. File write and read
            test_path = Path("/workspace/test_data.txt")
            await session.write(test_path, io.BytesIO(b"live verification data"))

            read_stream = await session.read(test_path)
            content = read_stream.read()
            assert content == b"live verification data"

            # 4. Verify via shell command inside the VM
            cat_res = await session.exec("cat test_data.txt")
            assert cat_res.exit_code == 0
            assert b"live verification data" in cat_res.stdout
    finally:
        await client.delete(session)


@pytest.mark.asyncio
async def test_live_manifest_materialization():
    with tempfile.TemporaryDirectory() as tmp_dir:
        repo_dir = Path(tmp_dir) / "repo"
        repo_dir.mkdir()
        (repo_dir / "script.sh").write_text(
            "#!/bin/sh\necho 'materialized successfully'\n"
        )

        client = SuperserveSandboxClient()
        manifest = Manifest(
            root="/workspace",
            entries={
                "repo": LocalDir(src=repo_dir),
            },
            extra_path_grants=(SandboxPathGrant(path=str(repo_dir)),),
        )
        session = await client.create(manifest=manifest)
        try:
            async with session:
                res = await session.exec("sh repo/script.sh")
                assert res.exit_code == 0
                assert b"materialized successfully" in res.stdout
        finally:
            await client.delete(session)
