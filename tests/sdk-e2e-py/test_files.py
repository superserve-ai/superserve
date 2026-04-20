import pytest

from superserve import Sandbox

from _helpers import SKIP_IF_NO_CREDS

pytestmark = SKIP_IF_NO_CREDS


@pytest.fixture(scope="module")
def sandbox(connection_opts, run_id):
    name = f"sdk-e2e-py-files-{run_id}"
    sbx = Sandbox.create(name=name, **connection_opts)
    yield sbx
    try:
        sbx.kill()
    except Exception as err:
        print(f"Cleanup failed for sandbox {sbx.id}: {err}")


def test_file_upload_download_roundtrip(sandbox, run_id):
    content = f"hello-from-py-e2e-{run_id}\n"
    path = "/home/user/e2e-probe.txt"

    sandbox.files.write(path, content)
    downloaded = sandbox.files.read_text(path)

    assert downloaded == content
