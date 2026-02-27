"""Tests for superserve init and deploy CLI commands."""

import json
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from superserve.cli.cli import cli
from superserve.cli.platform.client import PlatformAPIError
from superserve.cli.platform.types import AgentResponse


@pytest.fixture
def runner():
    """Provide a CLI runner."""
    return CliRunner()


def _make_agent_response(**overrides) -> AgentResponse:
    """Helper to create an AgentResponse with defaults."""
    defaults = {
        "id": "agt_test-uuid",
        "name": "my-agent",
        "command": "python main.py",
        "environment_keys": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    defaults.update(overrides)
    return AgentResponse(**defaults)


# ==================== Init Command ====================


class TestInitCommand:
    """Tests for superserve init command."""

    def test_init_creates_yaml(self, runner, tmp_path, monkeypatch):
        """Init creates superserve.yaml in current directory."""
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(cli, ["init"])

        assert result.exit_code == 0
        assert "Created superserve.yaml" in result.output
        assert "command" in result.output
        assert "superserve deploy" in result.output

    def test_init_with_name(self, runner, tmp_path, monkeypatch):
        """Init uses provided name."""
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(cli, ["init", "--name", "my-agent"])

        assert result.exit_code == 0
        yaml_content = (tmp_path / "superserve.yaml").read_text()
        assert "name: my-agent" in yaml_content

    def test_init_refuses_if_exists(self, runner, tmp_path, monkeypatch):
        """Init exits cleanly if superserve.yaml already exists."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text("name: existing\n")

        result = runner.invoke(cli, ["init"])

        assert result.exit_code == 0
        assert "already exists" in result.output

    def test_init_default_name_from_dir(self, runner, tmp_path, monkeypatch):
        """Init defaults name to directory name."""
        project_dir = tmp_path / "my-cool-project"
        project_dir.mkdir()
        monkeypatch.chdir(project_dir)

        result = runner.invoke(cli, ["init"])

        assert result.exit_code == 0
        yaml_content = (project_dir / "superserve.yaml").read_text()
        assert "name: my-cool-project" in yaml_content

    def test_init_yaml_has_ignore_section(self, runner, tmp_path, monkeypatch):
        """Init template includes commented ignore section."""
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(cli, ["init"])

        assert result.exit_code == 0
        yaml_content = (tmp_path / "superserve.yaml").read_text()
        assert "ignore:" in yaml_content


# ==================== Deploy Command ====================


class TestDeployCommand:
    """Tests for superserve deploy command."""

    def test_deploy_requires_yaml_or_entrypoint(self, runner, tmp_path, monkeypatch):
        """Deploy fails if neither entrypoint nor superserve.yaml provided."""
        monkeypatch.chdir(tmp_path)

        result = runner.invoke(cli, ["deploy"])

        assert result.exit_code == 1
        assert "superserve deploy <entrypoint>" in result.output
        assert "superserve.yaml" in result.output

    def test_deploy_requires_name(self, runner, tmp_path, monkeypatch):
        """Deploy fails if name missing from yaml."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text("command: python main.py\n")

        result = runner.invoke(cli, ["deploy"])

        assert result.exit_code == 1
        assert "name" in result.output.lower()

    def test_deploy_requires_command(self, runner, tmp_path, monkeypatch):
        """Deploy fails if command missing from yaml."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text("name: my-agent\n")

        result = runner.invoke(cli, ["deploy"])

        assert result.exit_code == 1
        assert "command" in result.output.lower()

    def test_deploy_success(self, runner, tmp_path, monkeypatch):
        """Deploy packages and uploads successfully."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 0
            assert "Deployed" in result.output
            assert "my-agent" in result.output
            mock_client.deploy_agent.assert_called_once()

    def test_deploy_json_output(self, runner, tmp_path, monkeypatch):
        """Deploy with --json outputs JSON."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy", "--json"])

            assert result.exit_code == 0
            data = json.loads(result.output)
            assert data["name"] == "my-agent"

    def test_deploy_not_authenticated(self, runner, tmp_path, monkeypatch):
        """Deploy shows auth error."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.side_effect = PlatformAPIError(
                401, "Not authenticated"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 1
            assert "login" in result.output.lower()

    def test_deploy_excludes_default_dirs(self, runner, tmp_path, monkeypatch):
        """Deploy excludes __pycache__, .git, .venv by default."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")
        (tmp_path / "__pycache__").mkdir()
        (tmp_path / "__pycache__" / "module.pyc").write_text("bytecode")
        (tmp_path / ".git").mkdir()
        (tmp_path / ".git" / "config").write_text("gitconfig")
        (tmp_path / ".env").write_text("SECRET=value")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 0
            mock_client.deploy_agent.assert_called_once()

    def test_deploy_excludes_user_ignores(self, runner, tmp_path, monkeypatch):
        """Deploy excludes paths listed in ignore field."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\nignore:\n  - data\n  - logs\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "big.csv").write_text("a,b,c")
        (tmp_path / "logs").mkdir()
        (tmp_path / "logs" / "app.log").write_text("log line")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 0
            mock_client.deploy_agent.assert_called_once()


# ==================== Zero-Config Deploy ====================


class TestZeroConfigDeploy:
    """Tests for zero-config deploy with entrypoint argument."""

    def test_deploy_with_entrypoint(self, runner, tmp_path, monkeypatch):
        """Deploy with entrypoint file works without superserve.yaml."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "agent.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response(
                name=tmp_path.name, command="python agent.py"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy", "agent.py"])

            assert result.exit_code == 0
            assert "Deployed" in result.output
            mock_client.deploy_agent.assert_called_once()
            call_kwargs = mock_client.deploy_agent.call_args[1]
            assert call_kwargs["name"] == tmp_path.name
            assert call_kwargs["command"] == "python agent.py"
            assert call_kwargs["config"]["entrypoint"] == "agent.py"
            assert call_kwargs["config"]["mode"] == "shim"

    def test_deploy_with_entrypoint_and_name(self, runner, tmp_path, monkeypatch):
        """--name flag sets the agent name."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "agent.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response(
                name="research-agent", command="python agent.py"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(
                cli, ["deploy", "agent.py", "--name", "research-agent"]
            )

            assert result.exit_code == 0
            call_kwargs = mock_client.deploy_agent.call_args[1]
            assert call_kwargs["name"] == "research-agent"

    def test_deploy_with_port(self, runner, tmp_path, monkeypatch):
        """--port flag sets mode to http and includes port in config."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "server.py").write_text("print('server')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response(
                name=tmp_path.name, command="python server.py"
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy", "server.py", "--port", "8000"])

            assert result.exit_code == 0
            call_kwargs = mock_client.deploy_agent.call_args[1]
            assert call_kwargs["config"]["mode"] == "http"
            assert call_kwargs["config"]["port"] == 8000

    def test_deploy_entrypoint_not_found(self, runner, tmp_path, monkeypatch):
        """Error if entrypoint file does not exist."""
        monkeypatch.chdir(tmp_path)

        result = runner.invoke(cli, ["deploy", "missing.py"])

        assert result.exit_code == 1
        assert "not found" in result.output.lower()
        assert "missing.py" in result.output

    def test_deploy_auto_detect_python(self, runner, tmp_path, monkeypatch):
        """Python file generates 'python agent.py' command."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "agent.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy", "agent.py"])

            assert result.exit_code == 0
            call_kwargs = mock_client.deploy_agent.call_args[1]
            assert call_kwargs["command"] == "python agent.py"

    def test_deploy_auto_detect_typescript(self, runner, tmp_path, monkeypatch):
        """TypeScript file generates 'npx tsx agent.ts' command."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "agent.ts").write_text("console.log('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy", "agent.ts"])

            assert result.exit_code == 0
            call_kwargs = mock_client.deploy_agent.call_args[1]
            assert call_kwargs["command"] == "npx tsx agent.ts"

    def test_deploy_backward_compat_yaml(self, runner, tmp_path, monkeypatch):
        """Existing yaml-based deploy still works when no entrypoint is given."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "superserve.yaml").write_text(
            "name: my-agent\ncommand: python main.py\n"
        )
        (tmp_path / "main.py").write_text("print('hello')\n")

        with patch("superserve.cli.commands.deploy.PlatformClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.deploy_agent.return_value = _make_agent_response()
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["deploy"])

            assert result.exit_code == 0
            assert "Deployed" in result.output
            call_kwargs = mock_client.deploy_agent.call_args[1]
            assert call_kwargs["name"] == "my-agent"
            assert call_kwargs["command"] == "python main.py"
