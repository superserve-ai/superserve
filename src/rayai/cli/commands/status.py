"""Check deployment status.

The `rayai status` command shows the status of cloud deployments.

Usage:
    rayai status            # List all deployments
    rayai status myapp      # Show specific deployment
    rayai status --json     # Output as JSON
"""

import json
import sys

import click

from rayai.cli.platform.auth import is_authenticated
from rayai.cli.platform.client import PlatformAPIError, PlatformClient
from rayai.cli.platform.types import DeploymentResponse


@click.command()
@click.argument("deployment_name", required=False)
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
def status(deployment_name: str | None, json_output: bool) -> None:
    """Check deployment status.

    Shows the status of one or all cloud deployments.
    Requires authentication via 'rayai login' first.

    Examples:
        rayai status            # List all deployments
        rayai status myapp      # Show specific deployment
        rayai status --json     # Output as JSON
    """
    if not is_authenticated():
        click.echo("Error: Not logged in. Run 'rayai login' first.", err=True)
        sys.exit(1)

    client = PlatformClient()

    try:
        if deployment_name:
            deployments = [client.get_deployment(deployment_name)]
        else:
            deployments = client.list_deployments()
    except PlatformAPIError as e:
        click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    if not deployments:
        click.echo("No deployments found.")
        click.echo("Deploy agents with 'rayai deploy'")
        return

    if json_output:
        _output_json(deployments)
    else:
        _output_table(deployments)


def _output_json(deployments: list[DeploymentResponse]) -> None:
    """Output deployments as JSON."""
    output = [
        {
            "id": d.id,
            "name": d.name,
            "status": d.status,
            "url": d.url,
            "agents": [a.name for a in d.agents],
            "created_at": d.created_at,
            "updated_at": d.updated_at,
            "error": d.error,
        }
        for d in deployments
    ]
    click.echo(json.dumps(output, indent=2))


def _output_table(deployments: list[DeploymentResponse]) -> None:
    """Output deployments as formatted table."""
    status_colors = {
        "running": "green",
        "failed": "red",
        "pending": "yellow",
        "building": "yellow",
        "deploying": "cyan",
        "stopped": "white",
    }

    for d in deployments:
        color = status_colors.get(d.status, "white")

        click.echo(f"\n{click.style(d.name, bold=True)}")
        click.echo(f"  Status:  {click.style(d.status, fg=color)}")

        if d.url:
            click.echo(f"  URL:     {d.url}")

        if d.agents:
            agent_names = ", ".join(a.name for a in d.agents)
            click.echo(f"  Agents:  {agent_names}")

        if d.created_at:
            click.echo(f"  Created: {d.created_at}")

        if d.error:
            click.echo(f"  Error:   {click.style(d.error, fg='red')}")

    click.echo()  # Trailing newline
