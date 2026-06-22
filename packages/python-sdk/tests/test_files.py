"""Tests for Files sub-module."""

from __future__ import annotations

import httpx
import pytest
import respx
from superserve.errors import ValidationError
from superserve.files import AsyncFiles, Files


def _make_files() -> Files:
    return Files(
        sandbox_id="abc-123",
        sandbox_host="sandbox.example.com",
        access_token="tok-xyz",
    )


def _make_async_files() -> AsyncFiles:
    return AsyncFiles(
        sandbox_id="abc-123",
        sandbox_host="sandbox.example.com",
        access_token="tok-xyz",
    )


class TestPathValidation:
    def test_write_rejects_non_absolute(self) -> None:
        with pytest.raises(ValidationError, match="start"):
            _make_files().write("relative/path", "hi")

    def test_read_rejects_non_absolute(self) -> None:
        with pytest.raises(ValidationError, match="start"):
            _make_files().read("relative/path")

    def test_read_text_rejects_non_absolute(self) -> None:
        with pytest.raises(ValidationError, match="start"):
            _make_files().read_text("relative/path")

    def test_write_rejects_parent_traversal(self) -> None:
        with pytest.raises(ValidationError, match=r"\.\."):
            _make_files().write("/safe/../etc/passwd", "x")

    def test_read_rejects_parent_traversal(self) -> None:
        with pytest.raises(ValidationError, match=r"\.\."):
            _make_files().read("/safe/../etc/passwd")

    def test_read_text_rejects_parent_traversal(self) -> None:
        with pytest.raises(ValidationError, match=r"\.\."):
            _make_files().read_text("/safe/../etc/passwd")

    def test_download_dir_rejects_non_absolute(self) -> None:
        with pytest.raises(ValidationError, match="start"):
            _make_files().download_dir("relative/dir")

    def test_download_dir_rejects_parent_traversal(self) -> None:
        with pytest.raises(ValidationError, match=r"\.\."):
            _make_files().download_dir("/safe/../etc")


class TestFilesWrite:
    def test_sends_access_token_header(self) -> None:
        with respx.mock() as router:
            route = router.post("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200)
            )
            _make_files().write("/home/x.txt", "hello")
            req = route.calls.last.request
            assert req.headers["X-Access-Token"] == "tok-xyz"

    def test_accepts_bytes_content(self) -> None:
        with respx.mock() as router:
            route = router.post("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200)
            )
            _make_files().write("/home/x.bin", b"\x00\x01\x02")
            assert route.calls.last.request.content == b"\x00\x01\x02"

    def test_encodes_str_as_utf8(self) -> None:
        with respx.mock() as router:
            route = router.post("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200)
            )
            _make_files().write("/home/x.txt", "héllo")
            assert route.calls.last.request.content == "héllo".encode()


class TestFilesRead:
    def test_returns_bytes(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"\x00raw bytes\x00")
            )
            result = _make_files().read("/home/x.bin")
            assert result == b"\x00raw bytes\x00"

    def test_sends_access_token_header(self) -> None:
        with respx.mock() as router:
            route = router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"ok")
            )
            _make_files().read("/home/x.txt")
            assert route.calls.last.request.headers["X-Access-Token"] == "tok-xyz"


class TestFilesReadText:
    def test_returns_string(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"hello world")
            )
            assert _make_files().read_text("/home/x.txt") == "hello world"

    def test_handles_utf8(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content="héllo".encode())
            )
            assert _make_files().read_text("/home/x.txt") == "héllo"


class TestFilesDownloadDir:
    def test_returns_zip_bytes(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"PK\x03\x04zip")
            )
            result = _make_files().download_dir("/home/project")
            assert result == b"PK\x03\x04zip"

    def test_sends_format_zip_and_access_token(self) -> None:
        with respx.mock() as router:
            route = router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"PK")
            )
            _make_files().download_dir("/home/project")
            req = route.calls.last.request
            assert req.url.params["format"] == "zip"
            assert req.url.params["path"] == "/home/project"
            assert req.headers["X-Access-Token"] == "tok-xyz"


class TestFilesDownloadByteCap:
    def test_read_over_cap_raises(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"x" * 100)
            )
            with pytest.raises(ValidationError, match="maximum size of 10 bytes"):
                _make_files().read("/home/big.bin", max_bytes=10)

    def test_read_under_cap_returns_bytes(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"small")
            )
            assert _make_files().read("/home/small.bin", max_bytes=1024) == b"small"

    def test_read_at_cap_returns_bytes(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"abcde")
            )
            assert _make_files().read("/home/exact.bin", max_bytes=5) == b"abcde"

    def test_download_dir_over_cap_raises(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"PK" + b"z" * 100)
            )
            with pytest.raises(ValidationError, match="maximum size"):
                _make_files().download_dir("/home/project", max_bytes=10)

    async def test_async_read_over_cap_raises(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"y" * 100)
            )
            with pytest.raises(ValidationError, match="maximum size of 10 bytes"):
                await _make_async_files().read("/home/big.bin", max_bytes=10)

    async def test_async_read_under_cap_returns_bytes(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"tiny")
            )
            result = await _make_async_files().read("/home/tiny.bin", max_bytes=1024)
            assert result == b"tiny"


class TestAsyncFilesDownloadDir:
    async def test_returns_zip_bytes(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"PK\x03\x04zip")
            )
            result = await _make_async_files().download_dir("/home/project")
            assert result == b"PK\x03\x04zip"

    async def test_sends_format_zip_and_access_token(self) -> None:
        with respx.mock() as router:
            route = router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content=b"PK")
            )
            await _make_async_files().download_dir("/home/project")
            req = route.calls.last.request
            assert req.url.params["format"] == "zip"
            assert req.headers["X-Access-Token"] == "tok-xyz"


class TestFilesSharedHostRouting:
    def test_uses_shared_host_when_supported(self) -> None:
        files = Files(
            sandbox_id="abc-123",
            sandbox_host="sandbox.superserve.ai",
            access_token="tok-xyz",
        )
        with respx.mock() as router:
            route = router.post("https://sandbox.superserve.ai/files").mock(
                return_value=httpx.Response(200)
            )
            files.write("/tmp/f.txt", "data")
            req = route.calls.last.request
            assert req.headers.get("x-superserve-sandbox-id") == "abc-123"
            assert req.headers.get("x-access-token") == "tok-xyz"

    def test_read_also_carries_sandbox_id_header_on_shared_host(self) -> None:
        files = Files(
            sandbox_id="abc-123",
            sandbox_host="sandbox.superserve.ai",
            access_token="tok-xyz",
        )
        with respx.mock() as router:
            route = router.get("https://sandbox.superserve.ai/files").mock(
                return_value=httpx.Response(200, content=b"hello")
            )
            files.read("/tmp/f.bin")
            req = route.calls.last.request
            assert req.headers.get("x-superserve-sandbox-id") == "abc-123"
