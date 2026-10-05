"""Routing optimization only; signature verification belongs to the server."""

from __future__ import annotations

import base64
import json
import time
from collections.abc import Callable


def routing_hint_headers(get_hint: Callable[[], str | None]) -> dict[str, str]:
    hint = get_hint()
    return {"X-Superserve-Routing-Hint": hint} if hint else {}


def routing_hint_expired(get_hint: Callable[[], str | None]) -> bool:
    hint = get_hint()
    if not hint:
        return False
    try:
        payload = hint.split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        expiry = data.get("e")
        return isinstance(expiry, (int, float)) and expiry <= time.time()
    except (ValueError, IndexError, TypeError, AttributeError):
        return False
