"""End-to-end tests for session features against staging.

These tests run real CLI commands via subprocess.run. They require:
- Authenticated CLI (`superserve login` done)
- `simple-agent` deployed on staging

Run with: pytest tests/test_e2e_sessions.py -m e2e
"""

import json
import subprocess
import time

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

AGENT_NAME = "simple-agent"


def run_cli(*args, input_text=None, timeout=120):
    """Run a superserve CLI command and return result."""
    result = subprocess.run(
        ["superserve"] + list(args),
        capture_output=True,
        text=True,
        input=input_text,
        timeout=timeout,
    )
    return result


def unique_tag():
    """Return a unique tag to avoid test interference."""
    return f"e2e_{int(time.time())}_{id(object()) % 10000}"


def get_latest_session_id(agent_name=AGENT_NAME):
    """Get the most recent session ID for an agent using JSON output.

    Returns the full session ID string, or None if no sessions found.
    """
    result = run_cli("sessions", "list", agent_name, "--json")
    if result.returncode != 0:
        return None
    try:
        sessions = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    if not sessions:
        return None
    # Sessions are returned most-recent first; take the first one.
    return sessions[0]["id"]


def parse_session_ids_from_table(stdout):
    """Parse session IDs from the table-formatted sessions list output.

    The table format (unfiltered) is:
        ID             AGENT              TITLE                    STATUS       MSGS   LAST ACTIVE
        ----------...
        8ff75147abcd   simple-agent       ...

    The ID column is a 12-char hex string (first column).
    Returns a list of ID strings.
    """
    ids = []
    for line in stdout.strip().splitlines():
        line = line.strip()
        # Skip header and separator lines
        if not line or line.startswith("ID") or line.startswith("-"):
            continue
        parts = line.split()
        if parts:
            ids.append(parts[0])
    return ids


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def session_cleanup():
    """Collect session IDs created during a test and end them in teardown."""
    created_ids = []
    yield created_ids
    for sid in created_ids:
        try:
            run_cli("sessions", "end", sid, timeout=30)
        except Exception:
            pass  # Best-effort cleanup


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.e2e
class TestE2ESessions:
    """End-to-end tests for session lifecycle via the CLI."""

    def test_sessions_list_after_run(self, session_cleanup):
        """After a run, sessions list shows the session as idle."""
        tag = unique_tag()
        run_result = run_cli("run", AGENT_NAME, f"Respond with OK {tag}", timeout=120)
        assert run_result.returncode == 0, f"Run failed: {run_result.stderr}"

        # Small delay to let the session status settle
        time.sleep(2)

        # Get the session ID for cleanup
        sid = get_latest_session_id()
        if sid:
            session_cleanup.append(sid)

        # List sessions (table output, filtered by agent)
        list_result = run_cli("sessions", "list", AGENT_NAME)
        assert list_result.returncode == 0, (
            f"sessions list failed: {list_result.stderr}"
        )
        output = list_result.stdout
        assert "idle" in output.lower(), (
            f"Expected 'idle' in sessions list output:\n{output}"
        )

    def test_file_persistence_across_resume(self, session_cleanup):
        """Files created in one turn persist when the session is resumed."""
        tag = unique_tag()
        filename = f"e2e-test-{tag}.txt"
        content_marker = f"hello-e2e-{tag}"

        # First turn: create a file
        run_result = run_cli(
            "run",
            AGENT_NAME,
            f"Create a file called {filename} containing exactly: {content_marker}",
            timeout=120,
        )
        assert run_result.returncode == 0, (
            f"File creation run failed: {run_result.stderr}"
        )

        time.sleep(2)

        # Get session ID
        sid = get_latest_session_id()
        assert sid is not None, "Could not find session after run"
        session_cleanup.append(sid)

        # Resume and ask to read the file
        resume_result = run_cli(
            "sessions",
            "resume",
            sid,
            input_text=f"Read the file {filename} and tell me its contents\nexit\n",
            timeout=120,
        )
        combined_output = resume_result.stdout + resume_result.stderr
        assert content_marker in combined_output, (
            f"Expected '{content_marker}' in resume output but got:\n"
            f"stdout: {resume_result.stdout}\nstderr: {resume_result.stderr}"
        )

    def test_end_session(self, session_cleanup):
        """Ending a session sets its status to completed."""
        tag = unique_tag()

        # Create a session
        run_result = run_cli("run", AGENT_NAME, f"Say done {tag}", timeout=120)
        assert run_result.returncode == 0, f"Run failed: {run_result.stderr}"

        time.sleep(2)

        sid = get_latest_session_id()
        assert sid is not None, "Could not find session after run"
        # Do NOT add to session_cleanup since we end it ourselves

        # End the session
        end_result = run_cli("sessions", "end", sid, timeout=30)
        assert end_result.returncode == 0, f"sessions end failed: {end_result.stderr}"

        # Verify status is completed
        get_result = run_cli("sessions", "get", sid, "--json", timeout=30)
        assert get_result.returncode == 0, f"sessions get failed: {get_result.stderr}"
        session_data = json.loads(get_result.stdout)
        assert session_data.get("status") == "completed", (
            f"Expected status 'completed', got '{session_data.get('status')}'"
        )

    def test_run_nonexistent_agent(self):
        """Running a nonexistent agent fails with 'not found'."""
        result = run_cli("run", "nonexistent-agent-xyz", "hello", timeout=60)
        assert result.returncode != 0, (
            f"Expected non-zero exit for nonexistent agent, got 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
        combined_output = (result.stdout + result.stderr).lower()
        assert "not found" in combined_output, (
            f"Expected 'not found' in output:\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )

    def test_resume_nonexistent_session(self):
        """Resuming a nonexistent session fails with 'not found'."""
        result = run_cli("sessions", "resume", "nonexistent123456", timeout=60)
        assert result.returncode != 0, (
            f"Expected non-zero exit for nonexistent session, got 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
        combined_output = (result.stdout + result.stderr).lower()
        assert "not found" in combined_output, (
            f"Expected 'not found' in output:\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
