"""Tests for superserve sessions CLI commands."""

from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from superserve.cli.cli import cli
from superserve.cli.platform.client import PlatformAPIError
from superserve.cli.platform.types import RunEvent


@pytest.fixture
def runner():
    """Provide a CLI runner."""
    return CliRunner()


def _make_session(**overrides):
    """Build a mock session dict with sensible defaults."""
    session = {
        "id": "ses_test-session-id",
        "title": "Test session",
        "agent_name": "simple-agent",
        "agent_id": "agt_123",
        "status": "idle",
        "message_count": 3,
        "created_at": "2026-02-20T00:00:00Z",
        "last_activity_at": "2026-02-20T01:00:00Z",
    }
    session.update(overrides)
    return session


# ==================== sessions list ====================


class TestSessionsList:
    """Tests for 'superserve sessions list'."""

    def test_list_shows_sessions(self, runner):
        """List command displays session data in a table."""
        sessions = [
            _make_session(),
            _make_session(
                id="ses_second-session",
                title="Another session",
                agent_name="other-agent",
                agent_id="agt_456",
                status="completed",
                message_count=7,
            ),
        ]

        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.list_sessions.return_value = sessions
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "list"])

            assert result.exit_code == 0
            assert "simple-agent" in result.output
            assert "other-agent" in result.output
            assert "Test session" in result.output
            assert "Another session" in result.output
            mock_client.list_sessions.assert_called_once_with(
                agent_id=None, status=None
            )

    def test_list_empty(self, runner):
        """List command shows message when no sessions exist."""
        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.list_sessions.return_value = []
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "list"])

            assert result.exit_code == 0
            assert "No sessions found." in result.output

    def test_list_filtered_by_agent(self, runner):
        """List command passes agent argument to list_sessions."""
        sessions = [_make_session()]

        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.list_sessions.return_value = sessions
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "list", "my-agent"])

            assert result.exit_code == 0
            mock_client.list_sessions.assert_called_once_with(
                agent_id="my-agent", status=None
            )


# ==================== sessions get ====================


class TestSessionsGet:
    """Tests for 'superserve sessions get'."""

    def test_get_shows_details(self, runner):
        """Get command displays session ID, status, agent, and message count."""
        session = _make_session()

        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.get_session.return_value = session
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "get", "ses_test-session-id"])

            assert result.exit_code == 0
            assert "ses_test-session-id" in result.output
            assert "idle" in result.output
            assert "simple-agent" in result.output
            assert "agt_123" in result.output
            assert "3" in result.output
            mock_client.get_session.assert_called_once_with("ses_test-session-id")

    def test_get_not_found(self, runner):
        """Get command exits 1 when session is not found."""
        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.get_session.side_effect = PlatformAPIError(
                404, "Session not found"
            )
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "get", "ses_nonexistent"])

            assert result.exit_code == 1


# ==================== sessions end ====================


class TestSessionsEnd:
    """Tests for 'superserve sessions end'."""

    def test_end_shows_status(self, runner):
        """End command displays the resulting session status."""
        session = _make_session(status="completed")

        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.end_session.return_value = session
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "end", "ses_test-session-id"])

            assert result.exit_code == 0
            assert "completed" in result.output
            mock_client.end_session.assert_called_once_with("ses_test-session-id")

    def test_end_not_found(self, runner):
        """End command exits 1 when session is not found."""
        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.end_session.side_effect = PlatformAPIError(
                404, "Session not found"
            )
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "end", "ses_nonexistent"])

            assert result.exit_code == 1


# ==================== sessions resume ====================


class TestSessionsResume:
    """Tests for 'superserve sessions resume'."""

    def test_resume_happy_path(self, runner):
        """Resume command enters interactive loop and streams events."""
        session = _make_session()
        events = [
            RunEvent(type="message.delta", data={"content": "Hi!"}),
            RunEvent(
                type="run.completed",
                data={"run_id": "r1", "duration_ms": 1000},
            ),
        ]

        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.resume_session.return_value = session
            mock_client.stream_session_message.return_value = iter(events)
            mock_cls.return_value = mock_client

            result = runner.invoke(
                cli, ["sessions", "resume", "abc123"], input="hello\nexit\n"
            )

            assert result.exit_code == 0
            mock_client.resume_session.assert_called_once_with("abc123")
            mock_client.stream_session_message.assert_called_once_with(
                "ses_test-session-id", "hello"
            )
            assert "Hi!" in result.output

    def test_resume_not_found(self, runner):
        """Resume command shows 'not found' and hint when session does not exist."""
        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.resume_session.side_effect = PlatformAPIError(
                404, "Session not found"
            )
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "resume", "abc123"])

            assert result.exit_code == 1
            assert "not found" in result.output.lower()
            assert "superserve sessions list" in result.output

    def test_resume_ambiguous_id(self, runner):
        """Resume command shows disambiguation hint on 409 conflict."""
        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.resume_session.side_effect = PlatformAPIError(
                409, "Multiple matches"
            )
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "resume", "abc"])

            assert result.exit_code == 1
            assert "Multiple matches" in result.output

    def test_resume_not_authenticated(self, runner):
        """Resume command shows auth error when not authenticated."""
        with patch("superserve.cli.commands.session.PlatformClient") as mock_cls:
            mock_client = MagicMock()
            mock_client.resume_session.side_effect = PlatformAPIError(
                401, "Not authenticated"
            )
            mock_cls.return_value = mock_client

            result = runner.invoke(cli, ["sessions", "resume", "abc123"])

            assert result.exit_code == 1
            assert "Not authenticated" in result.output
