"""MCP server management commands."""

import click

from .up import up


@click.group()
def mcp():
    """Manage MCP servers.

    Run MCP servers with Ray Serve.

    Examples:
        superserve mcp up                    # Run all MCP servers
        superserve mcp up --port 8001        # Custom port
        superserve mcp up --servers s1,s2    # Specific servers only
    """
    pass


mcp.add_command(up)
