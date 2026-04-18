"""HTTP client wrapping httpx with sync and async variants."""

from __future__ import annotations

import json as json_module
from typing import Any, Callable, Dict, Optional

import httpx

from .errors import SandboxError, SandboxTimeoutError, map_api_error

DEFAULT_TIMEOUT = 30.0


def api_request(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Optional[Any] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """Make a JSON API request. Returns parsed response body or None for 204."""
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.request(
                method,
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
            )
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Request timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Network error: {exc}") from exc

    if response.status_code == 204:
        return None

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {"error": {"message": response.text[:500] or f"API error ({response.status_code})"}}
        raise map_api_error(response.status_code, body)

    return response.json()


def upload_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    content: bytes,
    timeout: float = DEFAULT_TIMEOUT,
) -> None:
    """Upload raw bytes to data plane."""
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(
                url,
                headers={**headers, "Content-Type": "application/octet-stream"},
                content=content,
            )
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Upload timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Upload error: {exc}") from exc

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {"error": {"message": response.text[:500] or f"API error ({response.status_code})"}}
        raise map_api_error(response.status_code, body)


def download_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    timeout: float = DEFAULT_TIMEOUT,
) -> bytes:
    """Download raw bytes from data plane."""
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(url, headers=headers)
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Download timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Download error: {exc}") from exc

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {"error": {"message": response.text[:500] or f"API error ({response.status_code})"}}
        raise map_api_error(response.status_code, body)

    return response.content


def stream_sse(
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Any,
    timeout: float = 300.0,
    on_event: Callable[[Dict[str, Any]], None],
) -> None:
    """Consume an SSE stream from the exec/stream endpoint."""
    try:
        with httpx.Client(timeout=timeout) as client:
            with client.stream(
                "POST",
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
            ) as response:
                if not response.is_success:
                    response.read()
                    try:
                        body = response.json()
                    except Exception:
                        body = {"error": {"message": response.text[:500] or f"API error ({response.status_code})"}}
                    raise map_api_error(response.status_code, body)

                for line in response.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json_module.loads(data)
                        on_event(event)
                    except json_module.JSONDecodeError:
                        pass
    except SandboxError:
        raise
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Stream timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Stream error: {exc}") from exc


# ---------------------------------------------------------------------------
# Async variants
# ---------------------------------------------------------------------------


async def async_api_request(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Optional[Any] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """Async variant of api_request."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method,
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
            )
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Request timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Network error: {exc}") from exc

    if response.status_code == 204:
        return None

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {"error": {"message": response.text[:500] or f"API error ({response.status_code})"}}
        raise map_api_error(response.status_code, body)

    return response.json()


async def async_upload_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    content: bytes,
    timeout: float = DEFAULT_TIMEOUT,
) -> None:
    """Async variant of upload_bytes."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                headers={**headers, "Content-Type": "application/octet-stream"},
                content=content,
            )
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Upload timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Upload error: {exc}") from exc

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {"error": {"message": response.text[:500] or f"API error ({response.status_code})"}}
        raise map_api_error(response.status_code, body)


async def async_download_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    timeout: float = DEFAULT_TIMEOUT,
) -> bytes:
    """Async variant of download_bytes."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url, headers=headers)
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Download timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Download error: {exc}") from exc

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {"error": {"message": response.text[:500] or f"API error ({response.status_code})"}}
        raise map_api_error(response.status_code, body)

    return response.content


async def async_stream_sse(
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Any,
    timeout: float = 300.0,
    on_event: Callable[[Dict[str, Any]], None],
) -> None:
    """Async variant of stream_sse."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
            ) as response:
                if not response.is_success:
                    await response.aread()
                    try:
                        body = response.json()
                    except Exception:
                        body = {"error": {"message": response.text[:500] or f"API error ({response.status_code})"}}
                    raise map_api_error(response.status_code, body)

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json_module.loads(data)
                        on_event(event)
                    except json_module.JSONDecodeError:
                        pass
    except SandboxError:
        raise
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Stream timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Stream error: {exc}") from exc
