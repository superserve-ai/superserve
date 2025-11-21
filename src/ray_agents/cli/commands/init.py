"""Initialize new projects with templates."""

import shutil
from pathlib import Path

import click


@click.command()
@click.argument("project_name")
@click.option(
    "--type",
    "project_type",
    default="agent",
    type=click.Choice(["agent"]),
    help="Type of project to initialize (default: agent)",
)
def init(project_name: str, project_type: str):
    """Initialize a new project with the specified template."""

    cli_dir = Path(__file__).parent.parent
    template_dir = cli_dir / "templates" / project_type
    target_dir = Path.cwd() / project_name

    if not template_dir.exists():
        click.echo(f"Error: Template '{project_type}' not found")
        return

    if target_dir.exists():
        click.echo(f"Error: Directory '{project_name}' already exists")
        return

    try:
        shutil.copytree(template_dir, target_dir)
        click.echo(f"Created new {project_type} project: {project_name}")
        click.echo(f"Project location: {target_dir}")
        click.echo("\nNext steps:")
        click.echo(f"  cd {project_name}")
        click.echo("  # Edit .env file with your API keys")
        click.echo("  # Create your first agent: rayai create-agent <name>")
        click.echo("  # Deploy agents: rayai serve")

    except Exception as e:
        click.echo(f"Error: Failed to create project: {e}")
        if target_dir.exists():
            shutil.rmtree(target_dir)
