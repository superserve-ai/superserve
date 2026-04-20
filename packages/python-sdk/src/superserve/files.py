"""Files sub-module for uploading/downloading files to/from a sandbox."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from ._config import data_plane_url
from ._http import (
    async_download_bytes,
    async_upload_bytes,
    download_bytes,
    upload_bytes,
)
from .errors import ValidationError


def _validate_path(path: str) -> None:
    if not path.startswith("/"):
        raise ValidationError(f'Path must start with "/": {path}')
    if any(seg == ".." for seg in path.split("/")):
        raise ValidationError(f'Path must not contain ".." segments: {path}')


class Files:
    """Sync file operations. Access as ``sandbox.files``."""

    def __init__(
        self,
        sandbox_id: str,
        sandbox_host: str,
        access_token: str,
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = data_plane_url(sandbox_id, sandbox_host)
        self._access_token = access_token
        self._client = client

    def write(
        self, path: str, content: str | bytes, *, timeout: float | None = None
    ) -> None:
        """Write a file to the sandbox at the given absolute path."""
        _validate_path(path)
        if isinstance(content, str):
            content = content.encode("utf-8")
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs: dict[str, Any] = {
            "url": url,
            "headers": {"X-Access-Token": self._access_token},
            "content": content,
            "client": self._client,
        }
        if timeout is not None:
            kwargs["timeout"] = timeout
        upload_bytes(**kwargs)

    def read(self, path: str, *, timeout: float | None = None) -> bytes:
        """Read a file from the sandbox as raw bytes."""
        _validate_path(path)
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs: dict[str, Any] = {
            "url": url,
            "headers": {"X-Access-Token": self._access_token},
            "client": self._client,
        }
        if timeout is not None:
            kwargs["timeout"] = timeout
        return download_bytes(**kwargs)

    def read_text(self, path: str, *, timeout: float | None = None) -> str:
        """Read a file from the sandbox as a UTF-8 string."""
        _validate_path(path)
        return self.read(path, timeout=timeout).decode("utf-8")


class AsyncFiles:
    """Async file operations. Access as ``sandbox.files``."""

    def __init__(
        self,
        sandbox_id: str,
        sandbox_host: str,
        access_token: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = data_plane_url(sandbox_id, sandbox_host)
        self._access_token = access_token
        self._client = client

    async def write(
        self, path: str, content: str | bytes, *, timeout: float | None = None
    ) -> None:
        """Write a file to the sandbox at the given absolute path."""
        _validate_path(path)
        if isinstance(content, str):
            content = content.encode("utf-8")
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs: dict[str, Any] = {
            "url": url,
            "headers": {"X-Access-Token": self._access_token},
            "content": content,
            "client": self._client,
        }
        if timeout is not None:
            kwargs["timeout"] = timeout
        await async_upload_bytes(**kwargs)

    async def read(self, path: str, *, timeout: float | None = None) -> bytes:
        """Read a file from the sandbox as raw bytes."""
        _validate_path(path)
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs: dict[str, Any] = {
            "url": url,
            "headers": {"X-Access-Token": self._access_token},
            "client": self._client,
        }
        if timeout is not None:
            kwargs["timeout"] = timeout
        return await async_download_bytes(**kwargs)

    async def read_text(self, path: str, *, timeout: float | None = None) -> str:
        """Read a file from the sandbox as a UTF-8 string."""
        _validate_path(path)
        raw = await self.read(path, timeout=timeout)
        return raw.decode("utf-8")
