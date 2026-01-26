"""Log out from RayAI Cloud.

The `rayai logout` command clears stored credentials.

Usage:
    rayai logout    # Clear stored credentials
"""

import click

from rayai.cli.analytics import track
from rayai.cli.platform.auth import clear_credentials, get_credentials


@click.command()
def logout() -> None:
    """Log out from RayAI Cloud.

    Clears stored credentials from ~/.rayai/credentials.json.

    Examples:
        rayai logout    # Clear credentials
    """
    if not get_credentials():
        click.echo("Not logged in.")
        return

    clear_credentials()
    click.echo("Logged out successfully.")
    track("cli_logout", {})
