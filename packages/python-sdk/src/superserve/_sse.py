"""SSE parser for streaming exec output."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx


def parse_sse_stream(response: httpx.Response) -> Iterator[dict[str, Any]]:
    """Parse an SSE response into dicts, yielding each `data:` payload."""
    for line in response.iter_lines():
        if not line.startswith("data: "):
            continue
        try:
            yield json.loads(line[6:])
        except json.JSONDecodeError:
            continue
