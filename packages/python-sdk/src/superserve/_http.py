"""HTTP client wrapping httpx with sync and async variants.

Supports an optional injected ``httpx.Client`` / ``httpx.AsyncClient`` for
connection pooling and retry logic for idempotent methods (GET, DELETE).
"""

from __future__ import annotations

import asyncio
import json as json_module
import random
import sys
import time
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Dict, Optional

import httpx

from .errors import SandboxError, SandboxTimeoutError, map_api_error

DEFAULT_TIMEOUT = 30.0

SDK_VERSION = "0.6.0"
USER_AGENT = (
    f"superserve-python/{SDK_VERSION} "
    f"(python/{sys.version_info.major}.{sys.version_info.minor})"
)

# Retry tuning
_MAX_ATTEMPTS = 3
_BASE_BACKOFF = 0.1
_MAX_BACKOFF = 30.0
_RETRY_STATUS_CODES = {429, 502, 503, 504}
_IDEMPOTENT_METHODS = {"GET", "DELETE"}
_RETRY_CONNECTION_EXCEPTIONS = (
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
)


def _default_headers(extra: Dict[str, str], content_type: Optional[str] = None) -> Dict[str, str]:
    """Merge SDK defaults with caller-supplied headers.

    Caller-supplied headers override defaults.
    """
    defaults: Dict[str, str] = {"User-Agent": USER_AGENT}
    if content_type is not None:
        defaults["Content-Type"] = content_type
    defaults.update(extra)
    return defaults


def _compute_backoff(attempt: int) -> float:
    """Exponential backoff: 100ms, 200ms, 400ms with ±20% jitter, capped."""
    base = _BASE_BACKOFF * (2 ** attempt)
    jitter = base * (0.8 + random.random() * 0.4)
    return float(min(jitter, _MAX_BACKOFF))


def _parse_retry_after(value: Optional[str]) -> Optional[float]:
    """Parse Retry-After header (seconds or HTTP-date). Returns seconds or None."""
    if not value:
        return None
    value = value.strip()
    try:
        seconds = float(value)
        return max(0.0, seconds)
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    try:
        import datetime as _dt
        now = _dt.datetime.now(tz=dt.tzinfo) if dt.tzinfo else _dt.datetime.utcnow()
        delta = (dt - now).total_seconds()
    except Exception:
        return None
    return max(0.0, delta)


def _should_retry_status(method: str, status_code: int) -> bool:
    return (
        method.upper() in _IDEMPOTENT_METHODS
        and status_code in _RETRY_STATUS_CODES
    )


def _build_error_body(response: httpx.Response) -> Dict[str, Any]:
    try:
        parsed = response.json()
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {
        "error": {
            "message": response.text[:500]
            or f"API error ({response.status_code})"
        }
    }


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


def _do_request_with_retry(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Optional[Any] = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.Client] = None,
) -> httpx.Response:
    """Perform an HTTP request with retry for idempotent methods.

    Retries on 429/502/503/504 and on transient connection errors
    (``httpx.ConnectError``, ``httpx.ReadError``, ``httpx.RemoteProtocolError``).
    Never retries non-idempotent methods.
    """
    owned = client is None
    if owned:
        client = httpx.Client(timeout=timeout)
    assert client is not None

    method_upper = method.upper()
    last_exc: Optional[BaseException] = None

    try:
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = client.request(
                    method_upper,
                    url,
                    headers=headers,
                    json=json_body,
                    timeout=timeout,
                )
            except httpx.TimeoutException as exc:
                raise SandboxTimeoutError(
                    f"Request timed out after {timeout}s"
                ) from exc
            except _RETRY_CONNECTION_EXCEPTIONS as exc:
                last_exc = exc
                if method_upper not in _IDEMPOTENT_METHODS or attempt == _MAX_ATTEMPTS - 1:
                    raise SandboxError(f"Network error: {exc}") from exc
                time.sleep(_compute_backoff(attempt))
                continue
            except httpx.HTTPError as exc:
                raise SandboxError(f"Network error: {exc}") from exc

            if (
                _should_retry_status(method_upper, response.status_code)
                and attempt < _MAX_ATTEMPTS - 1
            ):
                delay: float
                if response.status_code == 429:
                    retry_after = _parse_retry_after(response.headers.get("Retry-After"))
                    delay = min(retry_after, _MAX_BACKOFF) if retry_after is not None else _compute_backoff(attempt)
                else:
                    delay = _compute_backoff(attempt)
                response.close()
                if delay > 0:
                    time.sleep(delay)
                continue

            return response

        # Should not reach here unless all attempts failed to a connection error
        if last_exc is not None:
            raise SandboxError(f"Network error: {last_exc}") from last_exc
        raise SandboxError("Request failed after retries")
    finally:
        if owned:
            client.close()


def api_request(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Optional[Any] = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.Client] = None,
) -> Any:
    """Make a JSON API request. Returns parsed response body or None for 204."""
    merged = _default_headers(headers, content_type="application/json")
    response = _do_request_with_retry(
        method,
        url,
        headers=merged,
        json_body=json_body,
        timeout=timeout,
        client=client,
    )

    if response.status_code == 204:
        return None

    if not response.is_success:
        raise map_api_error(response.status_code, _build_error_body(response))

    return response.json()


def upload_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    content: bytes,
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.Client] = None,
) -> None:
    """Upload raw bytes to data plane. POST — no retries."""
    owned = client is None
    if owned:
        client = httpx.Client(timeout=timeout)
    assert client is not None

    merged = _default_headers(headers, content_type="application/octet-stream")
    try:
        response = client.post(url, headers=merged, content=content, timeout=timeout)
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Upload timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Upload error: {exc}") from exc
    finally:
        if owned:
            client.close()

    if not response.is_success:
        raise map_api_error(response.status_code, _build_error_body(response))


def download_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.Client] = None,
) -> bytes:
    """Download raw bytes from data plane. GET — retries on transient failures."""
    merged = _default_headers(headers)
    response = _do_request_with_retry(
        "GET",
        url,
        headers=merged,
        timeout=timeout,
        client=client,
    )

    if not response.is_success:
        raise map_api_error(response.status_code, _build_error_body(response))

    return response.content


def stream_sse(
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Any,
    timeout: float = 300.0,
    on_event: Callable[[Dict[str, Any]], None],
    client: Optional[httpx.Client] = None,
) -> None:
    """Consume an SSE stream from the exec/stream endpoint. POST — no retries."""
    owned = client is None
    if owned:
        client = httpx.Client(timeout=timeout)
    assert client is not None

    merged = _default_headers(headers, content_type="application/json")
    try:
        with client.stream(
            "POST",
            url,
            headers=merged,
            json=json_body,
            timeout=timeout,
        ) as response:
            if not response.is_success:
                response.read()
                raise map_api_error(response.status_code, _build_error_body(response))

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
    finally:
        if owned:
            client.close()


# ---------------------------------------------------------------------------
# Async variants
# ---------------------------------------------------------------------------


async def _async_do_request_with_retry(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Optional[Any] = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.AsyncClient] = None,
) -> httpx.Response:
    """Async variant of ``_do_request_with_retry``."""
    owned = client is None
    if owned:
        client = httpx.AsyncClient(timeout=timeout)
    assert client is not None

    method_upper = method.upper()
    last_exc: Optional[BaseException] = None

    try:
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await client.request(
                    method_upper,
                    url,
                    headers=headers,
                    json=json_body,
                    timeout=timeout,
                )
            except httpx.TimeoutException as exc:
                raise SandboxTimeoutError(
                    f"Request timed out after {timeout}s"
                ) from exc
            except _RETRY_CONNECTION_EXCEPTIONS as exc:
                last_exc = exc
                if method_upper not in _IDEMPOTENT_METHODS or attempt == _MAX_ATTEMPTS - 1:
                    raise SandboxError(f"Network error: {exc}") from exc
                await asyncio.sleep(_compute_backoff(attempt))
                continue
            except httpx.HTTPError as exc:
                raise SandboxError(f"Network error: {exc}") from exc

            if (
                _should_retry_status(method_upper, response.status_code)
                and attempt < _MAX_ATTEMPTS - 1
            ):
                delay: float
                if response.status_code == 429:
                    retry_after = _parse_retry_after(response.headers.get("Retry-After"))
                    delay = min(retry_after, _MAX_BACKOFF) if retry_after is not None else _compute_backoff(attempt)
                else:
                    delay = _compute_backoff(attempt)
                await response.aclose()
                if delay > 0:
                    await asyncio.sleep(delay)
                continue

            return response

        if last_exc is not None:
            raise SandboxError(f"Network error: {last_exc}") from last_exc
        raise SandboxError("Request failed after retries")
    finally:
        if owned:
            await client.aclose()


async def async_api_request(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Optional[Any] = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.AsyncClient] = None,
) -> Any:
    """Async variant of api_request."""
    merged = _default_headers(headers, content_type="application/json")
    response = await _async_do_request_with_retry(
        method,
        url,
        headers=merged,
        json_body=json_body,
        timeout=timeout,
        client=client,
    )

    if response.status_code == 204:
        return None

    if not response.is_success:
        raise map_api_error(response.status_code, _build_error_body(response))

    return response.json()


async def async_upload_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    content: bytes,
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.AsyncClient] = None,
) -> None:
    """Async variant of upload_bytes. POST — no retries."""
    owned = client is None
    if owned:
        client = httpx.AsyncClient(timeout=timeout)
    assert client is not None

    merged = _default_headers(headers, content_type="application/octet-stream")
    try:
        response = await client.post(url, headers=merged, content=content, timeout=timeout)
    except httpx.TimeoutException as exc:
        raise SandboxTimeoutError(f"Upload timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Upload error: {exc}") from exc
    finally:
        if owned:
            await client.aclose()

    if not response.is_success:
        raise map_api_error(response.status_code, _build_error_body(response))


async def async_download_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.AsyncClient] = None,
) -> bytes:
    """Async variant of download_bytes. GET — retries on transient failures."""
    merged = _default_headers(headers)
    response = await _async_do_request_with_retry(
        "GET",
        url,
        headers=merged,
        timeout=timeout,
        client=client,
    )

    if not response.is_success:
        raise map_api_error(response.status_code, _build_error_body(response))

    return response.content


async def async_stream_sse(
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Any,
    timeout: float = 300.0,
    on_event: Callable[[Dict[str, Any]], None],
    client: Optional[httpx.AsyncClient] = None,
) -> None:
    """Async variant of stream_sse. POST — no retries."""
    owned = client is None
    if owned:
        client = httpx.AsyncClient(timeout=timeout)
    assert client is not None

    merged = _default_headers(headers, content_type="application/json")
    try:
        async with client.stream(
            "POST",
            url,
            headers=merged,
            json=json_body,
            timeout=timeout,
        ) as response:
            if not response.is_success:
                await response.aread()
                raise map_api_error(response.status_code, _build_error_body(response))

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
    finally:
        if owned:
            await client.aclose()
