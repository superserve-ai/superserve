"""MCP server management commands."""

import click

from .up import up


@click.group()
def mcp():
    """Manage MCP servers.

    Run MCP servers with Ray Serve.

    Examples:
        rayai mcp up                    # Run all MCP servers
        rayai mcp up --port 8001        # Custom port
        rayai mcp up --servers s1,s2    # Specific servers only
    """
    pass


mcp.add_command(up)
