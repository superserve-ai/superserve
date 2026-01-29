"""Remove a cloud project.

The `superserve delete` command removes a project from Superserve Cloud.

Usage:
    superserve delete myapp          # Delete with confirmation
    superserve delete myapp --force  # Delete without confirmation
"""

import sys

import click

from superserve.cli.analytics import track
from superserve.cli.platform.auth import is_authenticated
from superserve.cli.platform.client import PlatformAPIError, PlatformClient


@click.command()
@click.argument("project_name")
@click.option("--force", "-f", is_flag=True, help="Skip confirmation prompt")
def delete(project_name: str, force: bool) -> None:
    """Remove a cloud project.

    Deletes a project from Superserve Cloud. This action cannot be undone.
    Requires authentication via 'superserve login' first.

    Examples:
        superserve delete myapp          # Delete with confirmation
        superserve delete myapp --force  # Delete without confirmation
    """
    if not is_authenticated():
        click.echo("Error: Not logged in. Run 'superserve login' first.", err=True)
        sys.exit(1)

    if not force:
        click.confirm(
            f"Are you sure you want to delete project '{project_name}'?",
            abort=True,
        )

    client = PlatformClient()

    try:
        client.delete_project(project_name)
        click.echo(f"Project '{project_name}' deleted.")
        track("cli_delete", {})
    except PlatformAPIError as e:
        if e.status_code == 404:
            click.echo(f"Error: Project '{project_name}' not found.", err=True)
        else:
            click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)
