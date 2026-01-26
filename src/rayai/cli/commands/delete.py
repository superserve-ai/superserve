"""Remove a cloud deployment.

The `rayai delete` command removes a deployment from RayAI Cloud.

Usage:
    rayai delete myapp          # Delete with confirmation
    rayai delete myapp --force  # Delete without confirmation
"""

import sys

import click

from rayai.cli.analytics import track
from rayai.cli.platform.auth import is_authenticated
from rayai.cli.platform.client import PlatformAPIError, PlatformClient


@click.command()
@click.argument("deployment_name")
@click.option("--force", "-f", is_flag=True, help="Skip confirmation prompt")
def delete(deployment_name: str, force: bool) -> None:
    """Remove a cloud deployment.

    Deletes a deployment from RayAI Cloud. This action cannot be undone.
    Requires authentication via 'rayai login' first.

    Examples:
        rayai delete myapp          # Delete with confirmation
        rayai delete myapp --force  # Delete without confirmation
    """
    if not is_authenticated():
        click.echo("Error: Not logged in. Run 'rayai login' first.", err=True)
        sys.exit(1)

    if not force:
        click.confirm(
            f"Are you sure you want to delete deployment '{deployment_name}'?",
            abort=True,
        )

    client = PlatformClient()

    try:
        client.delete_deployment(deployment_name)
        click.echo(f"Deployment '{deployment_name}' deleted.")
        track("cli_delete", {})
    except PlatformAPIError as e:
        if e.status_code == 404:
            click.echo(f"Error: Deployment '{deployment_name}' not found.", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
