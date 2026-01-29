"""Log out from Superserve Cloud.

The `superserve logout` command clears stored credentials.

Usage:
    superserve logout    # Clear stored credentials
"""

import click

from superserve.cli.analytics import track
from superserve.cli.platform.auth import clear_credentials, get_credentials


@click.command()
def logout() -> None:
    """Log out from Superserve Cloud.

    Clears stored credentials from ~/.superserve/credentials.json.

    Examples:
        superserve logout    # Clear credentials
    """
    if not get_credentials():
        click.echo("Not logged in.")
        return

    clear_credentials()
    click.echo("Logged out successfully.")
    track("cli_logout", {})
