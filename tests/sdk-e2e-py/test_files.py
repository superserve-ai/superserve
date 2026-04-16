"""
End-to-end test for `client.files.upload_file` / `download_file`.

Files hit the data-plane edge proxy directly at
`boxd-{sandbox_id}.sandbox.superserve.ai`, bypassing the control plane.
Authentication uses the per-sandbox `access_token` from `SandboxResponse`.

Fern's Python generator has two quirks that force workarounds:

  1. `SuperserveEnvironment` is a structured object with separate `base` and
     `sandbox_data_plane` URLs. There's no per-call way to override the data
     plane URL, so we instantiate a second `Superserve` client with a custom
     environment whose `sandbox_data_plane` points at this sandbox's proxy.

  2. `upload_file` is generated without the `access_token` kwarg (Fern drops
     header parameters on operations with a binary request body). We pass
     `X-Access-Token` via `request_options.additional_headers` instead.
     `download_file` was generated correctly and takes `access_token=` as a
     normal kwarg.

See `spec/2026-04-16-sdk-fern-files-overlay-design.md`.
"""

import os

import pytest

from superserve import Superserve
from superserve.environment import SuperserveEnvironment

from _helpers import SKIP_IF_NO_CREDS, wait_for_status

pytestmark = SKIP_IF_NO_CREDS


@pytest.fixture(scope="module")
def sandbox(client, run_id):
    name = f"sdk-e2e-py-files-{run_id}"
    sbx = client.sandboxes.create_sandbox(name=name)
    assert sbx.id is not None
    assert sbx.access_token is not None
    wait_for_status(client, sbx.id, "active")
    yield sbx
    try:
        client.sandboxes.delete_sandbox(sbx.id)
    except Exception as err:
        print(f"Cleanup failed for sandbox {sbx.id}: {err}")


@pytest.fixture(scope="module")
def data_plane_client(sandbox) -> Superserve:
    """A Superserve client pointed at this sandbox's data-plane edge proxy.

    Used only for files.* methods. Lifecycle/exec/system calls should go
    through the main `client` fixture which targets the control plane.
    """
    base = os.environ.get("SUPERSERVE_BASE_URL", "https://api-staging.superserve.ai")
    env = SuperserveEnvironment(
        base=base,
        sandbox_data_plane=f"https://boxd-{sandbox.id}.sandbox.superserve.ai",
    )
    return Superserve(
        api_key=os.environ["SUPERSERVE_API_KEY"],
        environment=env,
    )


def test_file_upload_download_roundtrip(data_plane_client, sandbox, run_id):
    content = f"hello-from-py-e2e-{run_id}\n".encode()
    path = "/home/user/e2e-probe.txt"

    # Upload: Fern's Python generator dropped the X-Access-Token header
    # parameter (bug — operations with binary request bodies lose header
    # params). Pass it via request_options.additional_headers.
    data_plane_client.files.upload_file(
        path=path,
        request=content,
        request_options={
            "additional_headers": {"X-Access-Token": sandbox.access_token},
        },
    )

    # Download: access_token is a normal kwarg here (generator didn't drop it
    # because the operation has no request body).
    chunks = list(
        data_plane_client.files.download_file(
            path=path,
            access_token=sandbox.access_token,
        )
    )
    downloaded = b"".join(chunks)

    assert downloaded == content
