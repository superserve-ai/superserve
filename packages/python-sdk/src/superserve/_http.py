"""Internal HTTP client for the Superserve API."""

from __future__ import annotations

from typing import Any

import httpx

from superserve.errors import APIError

DEFAULT_BASE_URL = "https://api.superserve.ai"
DEFAULT_TIMEOUT = 30.0


class HttpClient:
    """Low-level HTTP client wrapping httpx."""

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            headers={
                "X-API-Key": api_key,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def request(
        self,
        method: str,
        endpoint: str,
        *,
        json: dict[str, Any] | None = None,
        content: bytes | None = None,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        url = f"{self._base_url}/v1{endpoint}"
        resp = self._client.request(
            method,
            url,
            json=json,
            content=content,
            params=params,
            headers=headers,
        )
        if resp.status_code >= 400:
            _raise_api_error(resp)
        return resp

    def stream(
        self,
        method: str,
        endpoint: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> httpx.Response:
        """Send a request and return the response without consuming the body."""
        url = f"{self._base_url}/v1{endpoint}"
        resp = self._client.send(
            self._client.build_request(method, url, json=json),
            stream=True,
        )
        if resp.status_code >= 400:
            resp.read()
            _raise_api_error(resp)
        return resp

    def close(self) -> None:
        self._client.close()


def _raise_api_error(resp: httpx.Response) -> None:
    try:
        data = resp.json()
        error_obj = data.get("error", {})
        code = error_obj.get("code", "unknown")
        message = error_obj.get("message", resp.reason_phrase or "Unknown error")
    except Exception:
        code = "unknown"
        message = resp.reason_phrase or "Unknown error"
    raise APIError(resp.status_code, code, message)
