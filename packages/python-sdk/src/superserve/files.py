"""``sandbox.files`` - read and write files inside a sandbox.

Hits the data plane with the per-sandbox access token. A paused sandbox (401
stale token, or 503 because the VM isn't running) is transparently resumed via
``POST /activate`` and the op is retried once — see ``_token_retry``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from ._config import data_plane_target
from ._http import (
    async_download_bytes,
    async_upload_bytes,
    download_bytes,
    upload_bytes,
)
from ._token_retry import async_with_token_retry, with_token_retry
from .errors import ValidationError


def _validate_path(path: str) -> None:
    if not path.startswith("/"):
        raise ValidationError(f'Path must start with "/": {path}')
    if any(seg == ".." for seg in path.split("/")):
        raise ValidationError(f'Path must not contain ".." segments: {path}')


@dataclass(frozen=True)
class FilesDeps:
    """Internal deps from Sandbox. ``refresh_activate`` resumes + rotates."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], str]


@dataclass(frozen=True)
class AsyncFilesDeps:
    """Async variant of FilesDeps."""

    sandbox_id: str
    sandbox_host: str
    get_access_token: Callable[[], str]
    refresh_activate: Callable[[], Awaitable[str]]


class Files:
    """Sync file operations. Access as ``sandbox.files``."""

    def __init__(
        self,
        deps: FilesDeps,
        client: httpx.Client | None = None,
    ) -> None:
        self._deps = deps
        target = data_plane_target(deps.sandbox_id, deps.sandbox_host)
        self._base_url = target.url
        self._routing_headers = target.headers
        self._client = client

    def write(
        self, path: str, content: str | bytes, *, timeout: float | None = None
    ) -> None:
        """Write a file to the sandbox at the given absolute path."""
        _validate_path(path)
        if isinstance(content, str):
            content = content.encode("utf-8")
        url = f"{self._base_url}/files?path={quote(path, safe='')}"

        def send(token: str) -> None:
            kwargs: dict[str, Any] = {
                "url": url,
                "headers": {**self._routing_headers, "X-Access-Token": token},
                "content": content,
                "client": self._client,
            }
            if timeout is not None:
                kwargs["timeout"] = timeout
            upload_bytes(**kwargs)

        with_token_retry(self._deps.get_access_token, self._deps.refresh_activate, send)

    def read(
        self,
        path: str,
        *,
        timeout: float | None = None,
        max_bytes: int | None = None,
    ) -> bytes:
        """Read a file from the sandbox as raw bytes.

        Downloads are capped at 2 GiB by default, overridable via ``max_bytes``.
        """
        _validate_path(path)
        url = f"{self._base_url}/files?path={quote(path, safe='')}"

        def send(token: str) -> bytes:
            kwargs: dict[str, Any] = {
                "url": url,
                "headers": {**self._routing_headers, "X-Access-Token": token},
                "client": self._client,
            }
            if timeout is not None:
                kwargs["timeout"] = timeout
            if max_bytes is not None:
                kwargs["max_bytes"] = max_bytes
            return download_bytes(**kwargs)

        return with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )

    def read_text(self, path: str, *, timeout: float | None = None) -> str:
        """Read a file from the sandbox as a UTF-8 string."""
        return self.read(path, timeout=timeout).decode("utf-8")

    def download_dir(
        self,
        path: str,
        *,
        timeout: float | None = None,
        max_bytes: int | None = None,
    ) -> bytes:
        """Download a directory from the sandbox as a ZIP archive.

        Returns the raw bytes of a zip file whose entries are prefixed with the
        directory's base name (e.g. ``<dir>/file.txt``). Symlinks are skipped.

        The server decides file-vs-directory: if ``path`` points at a regular
        file, its bytes are returned as-is (not zipped) -- use ``read()`` for
        files. Large directories can exceed the default timeout; pass
        ``timeout`` to allow more time.

        Downloads are capped at 2 GiB by default, overridable via ``max_bytes``.
        """
        _validate_path(path)
        url = f"{self._base_url}/files?path={quote(path, safe='')}&format=zip"

        def send(token: str) -> bytes:
            kwargs: dict[str, Any] = {
                "url": url,
                "headers": {**self._routing_headers, "X-Access-Token": token},
                "client": self._client,
            }
            if timeout is not None:
                kwargs["timeout"] = timeout
            if max_bytes is not None:
                kwargs["max_bytes"] = max_bytes
            return download_bytes(**kwargs)

        return with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )


class AsyncFiles:
    """Async file operations. Access as ``sandbox.files``."""

    def __init__(
        self,
        deps: AsyncFilesDeps,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._deps = deps
        target = data_plane_target(deps.sandbox_id, deps.sandbox_host)
        self._base_url = target.url
        self._routing_headers = target.headers
        self._client = client

    async def write(
        self, path: str, content: str | bytes, *, timeout: float | None = None
    ) -> None:
        """Write a file to the sandbox at the given absolute path."""
        _validate_path(path)
        if isinstance(content, str):
            content = content.encode("utf-8")
        url = f"{self._base_url}/files?path={quote(path, safe='')}"

        async def send(token: str) -> None:
            kwargs: dict[str, Any] = {
                "url": url,
                "headers": {**self._routing_headers, "X-Access-Token": token},
                "content": content,
                "client": self._client,
            }
            if timeout is not None:
                kwargs["timeout"] = timeout
            await async_upload_bytes(**kwargs)

        await async_with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )

    async def read(
        self,
        path: str,
        *,
        timeout: float | None = None,
        max_bytes: int | None = None,
    ) -> bytes:
        """Read a file from the sandbox as raw bytes.

        Downloads are capped at 2 GiB by default, overridable via ``max_bytes``.
        """
        _validate_path(path)
        url = f"{self._base_url}/files?path={quote(path, safe='')}"

        async def send(token: str) -> bytes:
            kwargs: dict[str, Any] = {
                "url": url,
                "headers": {**self._routing_headers, "X-Access-Token": token},
                "client": self._client,
            }
            if timeout is not None:
                kwargs["timeout"] = timeout
            if max_bytes is not None:
                kwargs["max_bytes"] = max_bytes
            return await async_download_bytes(**kwargs)

        return await async_with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )

    async def read_text(self, path: str, *, timeout: float | None = None) -> str:
        """Read a file from the sandbox as a UTF-8 string."""
        raw = await self.read(path, timeout=timeout)
        return raw.decode("utf-8")

    async def download_dir(
        self,
        path: str,
        *,
        timeout: float | None = None,
        max_bytes: int | None = None,
    ) -> bytes:
        """Download a directory from the sandbox as a ZIP archive.

        Returns the raw bytes of a zip file whose entries are prefixed with the
        directory's base name (e.g. ``<dir>/file.txt``). Symlinks are skipped.

        The server decides file-vs-directory: if ``path`` points at a regular
        file, its bytes are returned as-is (not zipped) -- use ``read()`` for
        files. Large directories can exceed the default timeout; pass
        ``timeout`` to allow more time.

        Downloads are capped at 2 GiB by default, overridable via ``max_bytes``.
        """
        _validate_path(path)
        url = f"{self._base_url}/files?path={quote(path, safe='')}&format=zip"

        async def send(token: str) -> bytes:
            kwargs: dict[str, Any] = {
                "url": url,
                "headers": {**self._routing_headers, "X-Access-Token": token},
                "client": self._client,
            }
            if timeout is not None:
                kwargs["timeout"] = timeout
            if max_bytes is not None:
                kwargs["max_bytes"] = max_bytes
            return await async_download_bytes(**kwargs)

        return await async_with_token_retry(
            self._deps.get_access_token, self._deps.refresh_activate, send
        )
