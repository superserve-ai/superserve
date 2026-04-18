"""Tests for Files sub-module."""

from __future__ import annotations

import httpx
import pytest
import respx

from superserve.errors import ValidationError
from superserve.files import Files


def _make_files() -> Files:
    return Files(
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


class TestFilesWrite:
    def test_sends_access_token_header(self) -> None:
        with respx.mock() as router:
            route = router.post(
                "https://boxd-abc-123.sandbox.example.com/files"
            ).mock(return_value=httpx.Response(200))
            _make_files().write("/home/x.txt", "hello")
            req = route.calls.last.request
            assert req.headers["X-Access-Token"] == "tok-xyz"

    def test_accepts_bytes_content(self) -> None:
        with respx.mock() as router:
            route = router.post(
                "https://boxd-abc-123.sandbox.example.com/files"
            ).mock(return_value=httpx.Response(200))
            _make_files().write("/home/x.bin", b"\x00\x01\x02")
            assert route.calls.last.request.content == b"\x00\x01\x02"

    def test_encodes_str_as_utf8(self) -> None:
        with respx.mock() as router:
            route = router.post(
                "https://boxd-abc-123.sandbox.example.com/files"
            ).mock(return_value=httpx.Response(200))
            _make_files().write("/home/x.txt", "héllo")
            assert route.calls.last.request.content == "héllo".encode("utf-8")


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
                return_value=httpx.Response(200, content="hello world".encode("utf-8"))
            )
            assert _make_files().read_text("/home/x.txt") == "hello world"

    def test_handles_utf8(self) -> None:
        with respx.mock() as router:
            router.get("https://boxd-abc-123.sandbox.example.com/files").mock(
                return_value=httpx.Response(200, content="héllo".encode("utf-8"))
            )
            assert _make_files().read_text("/home/x.txt") == "héllo"
