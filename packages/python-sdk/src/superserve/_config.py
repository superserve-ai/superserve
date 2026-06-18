"""Connection configuration for the Superserve Python SDK."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

from .errors import AuthenticationError, ValidationError

DEFAULT_BASE_URL = "https://api.superserve.ai"
DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai"


@dataclass(frozen=True)
class ResolvedConfig:
    api_key: str
    base_url: str
    sandbox_host: str


def resolve_config(
    api_key: str | None = None,
    base_url: str | None = None,
) -> ResolvedConfig:
    """Resolve connection config from explicit args + environment variables."""
    resolved_key = api_key or os.environ.get("SUPERSERVE_API_KEY")
    if not resolved_key:
        raise AuthenticationError(
            "Missing API key. Pass `api_key` or set the "
            "SUPERSERVE_API_KEY environment variable."
        )
    resolved_url = base_url or os.environ.get("SUPERSERVE_BASE_URL", DEFAULT_BASE_URL)
    sandbox_host = _derive_sandbox_host(resolved_url)
    return ResolvedConfig(
        api_key=resolved_key,
        base_url=resolved_url,
        sandbox_host=sandbox_host,
    )


# Sandbox hosts where the proxy supports shared-host routing.
_SUPPORTED_SHARED_HOSTS: frozenset[str] = frozenset(
    {
        "sandbox.superserve.ai",
        "staging-sandbox.superserve.ai",
    }
)

_SANDBOX_ID_HEADER = "X-Superserve-Sandbox-Id"


@dataclass(frozen=True)
class DataPlaneTarget:
    """Base URL + routing headers for one data-plane request."""

    url: str
    headers: dict[str, str]


def data_plane_target(sandbox_id: str, sandbox_host: str) -> DataPlaneTarget:
    """Resolve the data-plane base URL + routing headers for a sandbox.

    On a supported host, routes via the shared origin with
    X-Superserve-Sandbox-Id. Unsupported hosts fall back to the
    per-sandbox subdomain.
    """
    host = sandbox_host.lower()
    if host in _SUPPORTED_SHARED_HOSTS:
        return DataPlaneTarget(
            url=f"https://{host}",
            headers={_SANDBOX_ID_HEADER: sandbox_id},
        )
    return DataPlaneTarget(
        url=f"https://boxd-{sandbox_id}.{host}",
        headers={},
    )


# Lowest / highest TCP port a preview URL can target. Privileged ports
# (< 1024) are refused by the edge proxy, so we reject them up front.
MIN_PREVIEW_PORT = 1024
MAX_PREVIEW_PORT = 65535


def preview_url(sandbox_id: str, host: str, port: int) -> str:
    """Build the public preview URL for a port running inside a sandbox.

    The edge proxy routes ``https://{port}-{id}.{host}`` straight to that
    port on the VM, so this is pure string construction — no network call.
    The sandbox must be running and a server must be listening on ``port``
    for the URL to resolve.

    Always uses the per-sandbox subdomain form (never the shared-host mode):
    a browser opening the URL can't send the ``X-Superserve-Sandbox-Id``
    header.

    Raises:
        ValidationError: if ``port`` is not an integer in [1024, 65535].
    """
    if (
        not isinstance(port, int)
        or isinstance(port, bool)
        or port < MIN_PREVIEW_PORT
        or port > MAX_PREVIEW_PORT
    ):
        raise ValidationError(
            f"Invalid preview port {port!r}: must be an integer between "
            f"{MIN_PREVIEW_PORT} and {MAX_PREVIEW_PORT}. Privileged ports "
            f"(< {MIN_PREVIEW_PORT}) are not proxied."
        )
    return f"https://{port}-{sandbox_id}.{host}"


def _derive_sandbox_host(base_url: str) -> str:
    """Derive the data-plane sandbox host from the control-plane base URL.

    https://api.superserve.ai         -> sandbox.superserve.ai
    https://api-staging.superserve.ai -> staging-sandbox.superserve.ai
    Any other URL                      -> sandbox.superserve.ai (safe default)
    """
    try:
        parsed = urlparse(base_url)
        host = parsed.hostname or ""
        if host == "api-staging.superserve.ai":
            return "staging-sandbox.superserve.ai"
        if host == "api.superserve.ai":
            return DEFAULT_SANDBOX_HOST
    except ValueError:
        pass
    return DEFAULT_SANDBOX_HOST
