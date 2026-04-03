"""Lightweight, fire-and-forget telemetry for the Superserve Python SDK."""

from __future__ import annotations

import importlib.metadata
import os
import platform
import threading
import uuid
from typing import Any

_POSTHOG_KEY = "phc_gjpDKKKQJAnkxkqLrPGrAhoariKsaHNuTpI5rVhkYre"
_POSTHOG_URL = "https://us.i.posthog.com/capture/"

_distinct_id = str(uuid.uuid4())
_disabled = (
    os.environ.get("DO_NOT_TRACK") == "1"
    or os.environ.get("SUPERSERVE_DO_NOT_TRACK") == "1"
    or os.environ.get("SUPERSERVE_TELEMETRY") == "0"
)


def _get_version() -> str:
    try:
        return importlib.metadata.version("superserve")
    except Exception:
        return "unknown"


def _send(event: str, properties: dict[str, Any]) -> None:
    try:
        import httpx

        httpx.post(
            _POSTHOG_URL,
            json={
                "api_key": _POSTHOG_KEY,
                "event": event,
                "distinct_id": _distinct_id,
                "properties": {
                    "sdk": "python",
                    "sdk_version": _get_version(),
                    "python_version": platform.python_version(),
                    **properties,
                },
            },
            timeout=5.0,
        )
    except Exception:
        pass


def track_event(event: str, properties: dict[str, Any] | None = None) -> None:
    """Fire-and-forget telemetry event. Never throws, never blocks."""
    if _disabled:
        return
    threading.Thread(
        target=_send,
        args=(event, properties or {}),
        daemon=True,
    ).start()
