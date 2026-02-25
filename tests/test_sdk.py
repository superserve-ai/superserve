"""Tests for superserve.sdk — App, Session, and Stream."""

import io
import json
import sys
from unittest.mock import patch

import pytest

from superserve.sdk.app import App
from superserve.sdk.session import Session
from superserve.sdk.stream import Stream

# ---------------------------------------------------------------------------
# TestApp
# ---------------------------------------------------------------------------


class TestApp:
    """Tests for App class."""

    def test_run_without_handler_raises(self):
        """App.run() raises RuntimeError when no handler is registered."""
        app = App(name="test-agent")
        with pytest.raises(RuntimeError, match="No session handler registered"):
            app.run()

    def test_session_decorator_registers_handler(self):
        """@app.session decorator sets _session_handler."""
        app = App(name="test-agent")
        assert app._session_handler is None

        @app.session
        async def handler(session):
            pass

        assert app._session_handler is handler

    def test_mode_detection_terminal(self):
        """Without SUPERSERVE env var, mode is 'terminal'."""
        env = {k: v for k, v in __import__("os").environ.items() if k != "SUPERSERVE"}
        with patch.dict("os.environ", env, clear=True):
            App(name="test-agent")
            mode = (
                "platform"
                if __import__("os").environ.get("SUPERSERVE") == "1"
                else "terminal"
            )
            assert mode == "terminal"

    def test_mode_detection_platform(self):
        """With SUPERSERVE=1, mode is 'platform'."""
        with patch.dict("os.environ", {"SUPERSERVE": "1"}):
            import os

            mode = "platform" if os.environ.get("SUPERSERVE") == "1" else "terminal"
            assert mode == "platform"


# ---------------------------------------------------------------------------
# TestSessionPlatform
# ---------------------------------------------------------------------------


class TestSessionPlatform:
    """Tests for Session in platform mode."""

    def _make_session(self, fake_stdout):
        """Create a platform-mode Session with stdout redirected to fake_stdout."""
        original_stdout = sys.stdout
        sys.stdout = fake_stdout
        try:
            session = Session(mode="platform")
        finally:
            # Session._setup_platform_io replaces sys.stdout with sys.stderr,
            # so we restore it here for test isolation. The session keeps a
            # reference to the "real" stdout (our fake_stdout) internally.
            sys.stdout = original_stdout
        return session

    def test_sends_ready_on_init(self):
        """Session(mode='platform') writes {"type": "ready"} to stdout."""
        fake_stdout = io.StringIO()
        self._make_session(fake_stdout)

        output = fake_stdout.getvalue()
        lines = [line for line in output.strip().splitlines() if line]
        assert len(lines) == 1
        frame = json.loads(lines[0])
        assert frame == {"type": "ready"}

    @pytest.mark.asyncio
    async def test_platform_turns_yields_message(self):
        """stdin has a message frame then EOF -- yields (content, stream)."""
        fake_stdout = io.StringIO()
        session = self._make_session(fake_stdout)

        msg_frame = json.dumps({"type": "message", "content": "hello"}) + "\n"
        fake_stdin = io.StringIO(msg_frame)

        with patch("sys.stdin", fake_stdin):
            results = []
            async for message, stream in session.turns():
                results.append((message, stream))
            assert len(results) == 1
            assert results[0][0] == "hello"
            assert isinstance(results[0][1], Stream)

    @pytest.mark.asyncio
    async def test_platform_turns_emits_turn_done(self):
        """After yielding a message, session writes {"type": "turn_done"}."""
        fake_stdout = io.StringIO()
        session = self._make_session(fake_stdout)

        msg_frame = json.dumps({"type": "message", "content": "hi"}) + "\n"
        fake_stdin = io.StringIO(msg_frame)

        with patch("sys.stdin", fake_stdin):
            async for _message, _stream in session.turns():
                pass  # consume the turn so turn_done is emitted

        output = fake_stdout.getvalue()
        lines = [line for line in output.strip().splitlines() if line]
        frames = [json.loads(line) for line in lines]
        # First frame is "ready", second should be "turn_done"
        assert frames[0] == {"type": "ready"}
        assert frames[1] == {"type": "turn_done"}

    @pytest.mark.asyncio
    async def test_platform_turns_eof_exits(self):
        """Empty stdin (EOF) ends the turn loop without error."""
        fake_stdout = io.StringIO()
        session = self._make_session(fake_stdout)

        fake_stdin = io.StringIO("")
        with patch("sys.stdin", fake_stdin):
            results = []
            async for message, _stream in session.turns():
                results.append(message)
            assert results == []

    @pytest.mark.asyncio
    async def test_platform_turns_skips_non_json(self):
        """Non-JSON lines are skipped; next valid line still works."""
        fake_stdout = io.StringIO()
        session = self._make_session(fake_stdout)

        lines = (
            "this is not json\n"
            + json.dumps({"type": "message", "content": "ok"})
            + "\n"
        )
        fake_stdin = io.StringIO(lines)

        with patch("sys.stdin", fake_stdin):
            results = []
            async for message, _stream in session.turns():
                results.append(message)
            assert results == ["ok"]

    @pytest.mark.asyncio
    async def test_platform_turns_ignores_unknown_type(self):
        """Frames with unknown type are skipped, valid message still yields."""
        fake_stdout = io.StringIO()
        session = self._make_session(fake_stdout)

        lines = (
            json.dumps({"type": "unknown", "data": "ignored"})
            + "\n"
            + json.dumps({"type": "message", "content": "real"})
            + "\n"
        )
        fake_stdin = io.StringIO(lines)

        with patch("sys.stdin", fake_stdin):
            results = []
            async for message, _stream in session.turns():
                results.append(message)
            assert results == ["real"]


# ---------------------------------------------------------------------------
# TestStreamPlatform
# ---------------------------------------------------------------------------


class TestStreamPlatform:
    """Tests for Stream in platform mode."""

    def _make_platform_stream(self, fake_stdout):
        """Create a platform-mode Stream backed by a Session with fake stdout."""
        original_stdout = sys.stdout
        sys.stdout = fake_stdout
        try:
            session = Session(mode="platform")
        finally:
            sys.stdout = original_stdout
        # Clear the "ready" frame so we only capture stream output
        fake_stdout.truncate(0)
        fake_stdout.seek(0)
        return Stream(mode="platform", session=session)

    def test_write_text(self):
        """write('hello') emits {"type": "text", "content": "hello"}."""
        fake_stdout = io.StringIO()
        stream = self._make_platform_stream(fake_stdout)

        stream.write("hello")

        frame = json.loads(fake_stdout.getvalue().strip())
        assert frame == {"type": "text", "content": "hello"}

    def test_write_dict(self):
        """write(dict) serializes content as JSON string."""
        fake_stdout = io.StringIO()
        stream = self._make_platform_stream(fake_stdout)

        stream.write({"key": "val"})

        frame = json.loads(fake_stdout.getvalue().strip())
        assert frame["type"] == "text"
        # The content should be the JSON-serialized string of the dict
        assert frame["content"] == json.dumps({"key": "val"})

    def test_status(self):
        """status('Thinking') emits {"type": "status", "content": "Thinking"}."""
        fake_stdout = io.StringIO()
        stream = self._make_platform_stream(fake_stdout)

        stream.status("Thinking")

        frame = json.loads(fake_stdout.getvalue().strip())
        assert frame == {"type": "status", "content": "Thinking"}

    def test_metadata(self):
        """metadata(dict) emits {"type": "metadata", "data": ...}."""
        fake_stdout = io.StringIO()
        stream = self._make_platform_stream(fake_stdout)

        stream.metadata({"cost": 0.01})

        frame = json.loads(fake_stdout.getvalue().strip())
        assert frame == {"type": "metadata", "data": {"cost": 0.01}}


# ---------------------------------------------------------------------------
# TestStreamTerminal
# ---------------------------------------------------------------------------


class TestStreamTerminal:
    """Tests for Stream in terminal mode."""

    def test_write_prints_to_stdout(self, capsys):
        """write('hello') prints to stdout in terminal mode."""
        stream = Stream(mode="terminal")
        stream.write("hello")

        captured = capsys.readouterr()
        assert "hello" in captured.out

    def test_metadata_is_noop(self, capsys):
        """metadata({}) produces no output in terminal mode."""
        stream = Stream(mode="terminal")
        stream.metadata({})

        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""
