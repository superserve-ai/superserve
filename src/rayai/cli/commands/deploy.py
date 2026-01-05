"""Deploy agents to RayAI Cloud.

The `rayai deploy` command packages and deploys agents to RayAI Cloud.
It discovers agents in the agents/ directory, packages them, and uploads
to the Platform API.

Usage:
    rayai deploy                        # Deploy all agents
    rayai deploy --name myapp           # Custom deployment name
    rayai deploy --agents a,b           # Deploy specific agents
    rayai deploy --env-file .env.prod   # Include environment file
"""

import sys
import time
from pathlib import Path

import click
from dotenv import dotenv_values

from rayai.cli.analytics import track
from rayai.cli.platform.auth import is_authenticated
from rayai.cli.platform.client import PlatformAPIError, PlatformClient
from rayai.cli.platform.packaging import package_deployment


@click.command()
@click.argument("project_path", default=".")
@click.option("--agents", help="Deploy specific agents only (comma-separated)")
@click.option("--name", help="Deployment name (defaults to project directory name)")
@click.option("--env", multiple=True, help="Environment variable (KEY=VALUE)")
@click.option("--env-file", type=click.Path(exists=True), help="Path to .env file")
@click.option("--wait/--no-wait", default=True, help="Wait for deployment to complete")
def deploy(
    project_path: str,
    agents: str | None,
    name: str | None,
    env: tuple[str, ...],
    env_file: str | None,
    wait: bool,
) -> None:
    """Deploy agents to RayAI Cloud.

    Discovers agents in the agents/ directory, packages them, and deploys
    to RayAI Cloud. Requires authentication via 'rayai login' first.

    Examples:
        rayai deploy                        # Deploy all agents
        rayai deploy --name myapp           # Custom deployment name
        rayai deploy --agents agent1,agent2 # Deploy specific agents
        rayai deploy --env API_KEY=xxx      # With environment variable
        rayai deploy --env-file .env.prod   # With env file
        rayai deploy --no-wait              # Don't wait for completion
    """
    if not is_authenticated():
        click.echo("Error: Not logged in. Run 'rayai login' first.", err=True)
        sys.exit(1)

    project_dir = Path(project_path).resolve()

    if not project_dir.exists():
        click.echo(f"Error: Directory not found: {project_dir}", err=True)
        sys.exit(1)

    agents_dir = project_dir / "agents"
    if not agents_dir.exists():
        click.echo(f"Error: agents/ directory not found in {project_dir}", err=True)
        click.echo("Create agents using 'rayai create-agent <name>'")
        sys.exit(1)

    # Deployment name defaults to project directory name
    deployment_name = name or project_dir.name

    # Collect environment variables
    env_vars: dict[str, str] = {}
    if env_file:
        loaded = dotenv_values(env_file)
        env_vars.update({k: v for k, v in loaded.items() if v is not None})
    for e in env:
        if "=" in e:
            k, v = e.split("=", 1)
            env_vars[k] = v

    # Discover agents
    click.echo("Discovering agents...")
    registered = _discover_agents(project_dir, agents_dir, agents)

    if not registered:
        click.echo("Error: No agents found to deploy.", err=True)
        sys.exit(1)

    click.echo(f"\nFound {len(registered)} agent(s):")
    for config in registered:
        click.echo(f"  - {config.name} ({config.route_prefix})")

    # Package deployment
    click.echo("\nPackaging deployment...")
    try:
        package_path, manifest = package_deployment(
            project_dir, registered, deployment_name
        )
        click.echo(f"Package created: {manifest.checksum[:12]}...")
    except Exception as e:
        click.echo(f"Error packaging deployment: {e}", err=True)
        sys.exit(1)

    # Deploy to Platform API
    click.echo(f"\nDeploying '{deployment_name}' to RayAI Cloud...")
    client = PlatformClient()

    try:
        deployment = client.create_deployment(
            deployment_name, str(package_path), env_vars
        )
    except PlatformAPIError as e:
        click.echo(f"Error: {e.message}", err=True)
        if e.details:
            click.echo(f"Details: {e.details}", err=True)
        sys.exit(1)
    finally:
        # Clean up temporary package file
        package_path.unlink(missing_ok=True)

    click.echo(f"Deployment '{deployment.name}' created (status: {deployment.status})")

    # Wait for deployment to complete
    if wait and deployment.status not in ("running", "failed", "stopped"):
        click.echo("\nWaiting for deployment to complete...")
        deployment = _wait_for_deployment(client, deployment_name)

    # Print result
    if deployment.status == "running":
        click.echo(click.style("\nDeployment successful!", fg="green"))
        if deployment.url:
            click.echo(f"URL: {deployment.url}")
    elif deployment.status == "failed":
        click.echo(click.style("\nDeployment failed!", fg="red"), err=True)
        if deployment.error:
            click.echo(f"Error: {deployment.error}", err=True)
        sys.exit(1)

    track("cli_deploy", {"agent_count": len(registered)})


def _discover_agents(
    project_dir: Path, agents_dir: Path, agent_filter: str | None
) -> list:
    """Discover agents in the project.

    Args:
        project_dir: Project root directory.
        agents_dir: Path to agents/ directory.
        agent_filter: Comma-separated list of agents to include.

    Returns:
        List of AgentConfig objects.
    """
    # Import here to avoid circular imports and Ray initialization
    # Reuse agent import logic from up.py
    from rayai.cli.commands.up import _import_agent_modules
    from rayai.serve import (
        clear_registered_agents,
        get_registered_agents,
        set_rayai_up_mode,
    )

    set_rayai_up_mode(True)
    clear_registered_agents()

    # Parse filter
    filter_set = None
    if agent_filter:
        filter_set = {a.strip() for a in agent_filter.split(",")}

    # Add project to path for imports
    if str(project_dir) not in sys.path:
        sys.path.insert(0, str(project_dir))

    # Import agent modules
    imported = _import_agent_modules(agents_dir, filter_set)
    if imported == 0:
        return []

    return get_registered_agents()


def _wait_for_deployment(client: PlatformClient, name: str):
    """Wait for deployment to reach terminal state.

    Args:
        client: Platform API client.
        name: Deployment name.

    Returns:
        Final DeploymentResponse state.
    """
    terminal_states = {"running", "failed", "stopped"}
    poll_interval = 5

    while True:
        time.sleep(poll_interval)
        try:
            deployment = client.get_deployment(name)
        except PlatformAPIError as e:
            click.echo(f"Error checking status: {e.message}", err=True)
            break

        status_color = {
            "running": "green",
            "failed": "red",
            "pending": "yellow",
            "building": "yellow",
            "deploying": "cyan",
        }.get(deployment.status, "white")

        click.echo(f"  Status: {click.style(deployment.status, fg=status_color)}")

        if deployment.status in terminal_states:
            return deployment

    # Return last known state
    return deployment
