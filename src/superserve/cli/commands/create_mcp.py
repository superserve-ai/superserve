"""Create new MCP servers."""

import shutil
from pathlib import Path

import click

from superserve.cli.analytics import track


@click.command(name="create-mcp")
@click.argument("server_name")
def create_mcp(server_name: str):
    """Create a new MCP server.

    Creates mcp_servers/<name>/server.py with a FastMCP template.
    The server uses Streamable HTTP mode for deployment with Ray Serve.

    Examples:
        superserve create-mcp weather
        superserve create-mcp search
    """
    mcp_servers_dir = Path.cwd() / "mcp_servers"

    # Auto-create mcp_servers/ if it doesn't exist
    if not mcp_servers_dir.exists():
        mcp_servers_dir.mkdir()
        (mcp_servers_dir / "__init__.py").write_text('"""MCP servers."""\n')
        click.echo("Created mcp_servers/ directory")

    # Validate server name
    if not server_name.isidentifier():
        click.echo(f"Error: '{server_name}' is not a valid Python identifier")
        return

    server_dir = mcp_servers_dir / server_name
    if server_dir.exists():
        click.echo(f"Error: MCP server '{server_name}' already exists")
        return

    try:
        # Create server directory
        server_dir.mkdir()
        _create_server_files(server_dir, server_name)

        click.echo(f"Created MCP server: {server_name}")
        click.echo(f"Location: {server_dir}")

        track("cli_create_mcp", {"server_name": server_name})

        click.echo("\nNext steps:")
        click.echo(f"  1. Edit mcp_servers/{server_name}/server.py")
        click.echo("  2. Add your tools with @mcp.tool()")
        click.echo("  3. Run with: superserve mcp up")

    except Exception as e:
        click.echo(f"Error: Failed to create MCP server: {e}")
        if server_dir.exists():
            shutil.rmtree(server_dir)


def _create_server_files(server_dir: Path, server_name: str):
    """Create the MCP server files."""
    # Create __init__.py
    (server_dir / "__init__.py").write_text(f'"""MCP server: {server_name}."""\n')

    # Create server.py with template
    (server_dir / "server.py").write_text(_get_template(server_name))


def _get_template(server_name: str) -> str:
    """Get the FastMCP server template."""
    return f'''"""MCP Server: {server_name}

Streamable HTTP server deployed with Ray Serve.

Run with:
    superserve mcp up
"""

from mcp.server.fastmcp import FastMCP

import superserve

# Create FastMCP in stateless HTTP mode (required for Ray Serve)
mcp = FastMCP("{server_name}", stateless_http=True)


@mcp.tool()
async def example_tool(query: str) -> str:
    """Example tool - replace with your own.

    Args:
        query: Input query to process
    """
    return f"Processed: {{query}}"


# Deploy with Ray Serve
superserve.serve_mcp(mcp, name="{server_name}")
'''
