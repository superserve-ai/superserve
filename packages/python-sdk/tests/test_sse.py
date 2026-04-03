"""Tests for the SSE stream parser."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from superserve._sse import parse_sse_stream


class _FakeResponse:
    """Minimal stand-in for httpx.Response with iter_lines() and close()."""

    def __init__(self, lines: list[str]) -> None:
        self._lines = lines
        self.closed = False

    def iter_lines(self) -> list[str]:
        return self._lines

    def close(self) -> None:
        self.closed = True


class TestParseSSEStream:
    def test_parses_data_lines(self):
        resp = _FakeResponse([
            'data: {"type": "stdout", "data": "hello\\n"}',
            'data: {"type": "stdout", "data": "world\\n"}',
            'data: {"type": "exit", "exit_code": 0}',
        ])
        events = list(parse_sse_stream(resp))  # type: ignore[arg-type]
        assert len(events) == 3
        assert events[0] == {"type": "stdout", "data": "hello\n"}
        assert events[1] == {"type": "stdout", "data": "world\n"}
        assert events[2] == {"type": "exit", "exit_code": 0}
        assert resp.closed

    def test_skips_non_data_lines(self):
        resp = _FakeResponse([
            ": this is a comment",
            "",
            "event: message",
            'data: {"type": "stdout", "data": "ok"}',
            "id: 42",
        ])
        events = list(parse_sse_stream(resp))  # type: ignore[arg-type]
        assert len(events) == 1
        assert events[0]["type"] == "stdout"
        assert resp.closed

    def test_skips_malformed_json(self):
        resp = _FakeResponse([
            "data: not-json",
            'data: {"type": "stdout", "data": "good"}',
            "data: {broken",
        ])
        events = list(parse_sse_stream(resp))  # type: ignore[arg-type]
        assert len(events) == 1
        assert events[0]["data"] == "good"
        assert resp.closed

    def test_closes_response_on_completion(self):
        resp = _FakeResponse([
            'data: {"type": "exit", "exit_code": 0}',
        ])
        list(parse_sse_stream(resp))  # type: ignore[arg-type]
        assert resp.closed

    def test_closes_response_on_early_break(self):
        resp = _FakeResponse([
            'data: {"type": "stdout", "data": "line1"}',
            'data: {"type": "stdout", "data": "line2"}',
            'data: {"type": "stdout", "data": "line3"}',
        ])
        gen = parse_sse_stream(resp)  # type: ignore[arg-type]
        first = next(gen)
        assert first["data"] == "line1"
        # Simulate early break by closing the generator.
        gen.close()
        assert resp.closed

    def test_empty_stream(self):
        resp = _FakeResponse([])
        events = list(parse_sse_stream(resp))  # type: ignore[arg-type]
        assert events == []
        assert resp.closed
