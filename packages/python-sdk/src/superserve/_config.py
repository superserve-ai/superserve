"""Connection configuration for the Superserve Python SDK."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

from .errors import AuthenticationError

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


def data_plane_url(sandbox_id: str, sandbox_host: str) -> str:
    """Build the data-plane base URL for a specific sandbox."""
    return f"https://boxd-{sandbox_id}.{sandbox_host}"


def _derive_sandbox_host(base_url: str) -> str:
    """Derive the data-plane sandbox host from the control-plane base URL.

    https://api.superserve.ai         -> sandbox.superserve.ai
    https://api-staging.superserve.ai -> sandbox-staging.superserve.ai
    Any other URL                      -> sandbox.superserve.ai (safe default)
    """
    try:
        parsed = urlparse(base_url)
        host = parsed.hostname or ""
        if host == "api-staging.superserve.ai":
            return "sandbox-staging.superserve.ai"
        if host == "api.superserve.ai":
            return DEFAULT_SANDBOX_HOST
    except ValueError:
        pass
    return DEFAULT_SANDBOX_HOST
