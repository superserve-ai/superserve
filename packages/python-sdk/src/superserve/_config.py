"""Connection configuration for the Superserve Python SDK."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://api.superserve.ai"
DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai"


@dataclass(frozen=True)
class ResolvedConfig:
    api_key: str
    base_url: str
    sandbox_host: str


def resolve_config(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> ResolvedConfig:
    """Resolve connection config from explicit args + environment variables."""
    resolved_key = api_key or os.environ.get("SUPERSERVE_API_KEY")
    if not resolved_key:
        raise ValueError(
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
    """Derive the sandbox host from the control-plane base URL."""
    try:
        parsed = urlparse(base_url)
        if parsed.hostname and parsed.hostname.endswith("superserve.ai"):
            return DEFAULT_SANDBOX_HOST
    except Exception:
        pass
    return DEFAULT_SANDBOX_HOST
