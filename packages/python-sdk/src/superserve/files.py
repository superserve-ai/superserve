"""Files sub-module for uploading/downloading files to/from a sandbox."""

from __future__ import annotations

from typing import Optional, Union
from urllib.parse import quote

from ._config import data_plane_url
from ._http import (
    upload_bytes,
    download_bytes,
    async_upload_bytes,
    async_download_bytes,
)
from .errors import ValidationError


def _validate_path(path: str) -> None:
    if not path.startswith("/"):
        raise ValidationError(f'Path must start with "/": {path}')
    if any(seg == ".." for seg in path.split("/")):
        raise ValidationError(f'Path must not contain ".." segments: {path}')


class Files:
    """Sync file operations. Access as ``sandbox.files``."""

    def __init__(self, sandbox_id: str, sandbox_host: str, access_token: str) -> None:
        self._base_url = data_plane_url(sandbox_id, sandbox_host)
        self._access_token = access_token

    def write(
        self, path: str, content: Union[str, bytes], *, timeout: Optional[float] = None
    ) -> None:
        """Write a file to the sandbox at the given absolute path."""
        _validate_path(path)
        if isinstance(content, str):
            content = content.encode("utf-8")
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs = {
            "url": url,
            "headers": {"X-Access-Token": self._access_token},
            "content": content,
        }
        if timeout is not None:
            kwargs["timeout"] = timeout
        upload_bytes(**kwargs)

    def read(self, path: str, *, timeout: Optional[float] = None) -> bytes:
        """Read a file from the sandbox as raw bytes."""
        _validate_path(path)
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs = {"url": url, "headers": {"X-Access-Token": self._access_token}}
        if timeout is not None:
            kwargs["timeout"] = timeout
        return download_bytes(**kwargs)

    def read_text(self, path: str, *, timeout: Optional[float] = None) -> str:
        """Read a file from the sandbox as a UTF-8 string."""
        _validate_path(path)
        return self.read(path, timeout=timeout).decode("utf-8")


class AsyncFiles:
    """Async file operations. Access as ``sandbox.files``."""

    def __init__(self, sandbox_id: str, sandbox_host: str, access_token: str) -> None:
        self._base_url = data_plane_url(sandbox_id, sandbox_host)
        self._access_token = access_token

    async def write(
        self, path: str, content: Union[str, bytes], *, timeout: Optional[float] = None
    ) -> None:
        """Write a file to the sandbox at the given absolute path."""
        _validate_path(path)
        if isinstance(content, str):
            content = content.encode("utf-8")
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs = {
            "url": url,
            "headers": {"X-Access-Token": self._access_token},
            "content": content,
        }
        if timeout is not None:
            kwargs["timeout"] = timeout
        await async_upload_bytes(**kwargs)

    async def read(self, path: str, *, timeout: Optional[float] = None) -> bytes:
        """Read a file from the sandbox as raw bytes."""
        _validate_path(path)
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs = {"url": url, "headers": {"X-Access-Token": self._access_token}}
        if timeout is not None:
            kwargs["timeout"] = timeout
        return await async_download_bytes(**kwargs)

    async def read_text(self, path: str, *, timeout: Optional[float] = None) -> str:
        """Read a file from the sandbox as a UTF-8 string."""
        _validate_path(path)
        raw = await self.read(path, timeout=timeout)
        return raw.decode("utf-8")
