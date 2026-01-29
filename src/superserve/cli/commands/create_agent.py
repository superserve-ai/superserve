"""Create new agents within a project."""

import shutil
from pathlib import Path

import click

from superserve.cli.analytics import track

SUPPORTED_FRAMEWORKS = ["python", "langchain", "pydantic"]


@click.command(name="create-agent")
@click.argument("agent_name")
@click.option(
    "--framework",
    type=click.Choice(SUPPORTED_FRAMEWORKS),
    default="python",
    help="Framework to use for the agent (default: python)",
)
def create_agent(agent_name: str, framework: str):
    """Create a new agent with the specified name."""
    agents_dir = Path.cwd() / "agents"

    if not agents_dir.exists():
        click.echo("Error: Not in a superserve project directory.")
        click.echo(
            "Run 'superserve init <project_name>' to create a new project first."
        )
        return

    if not agent_name.isidentifier():
        click.echo(f"Error: '{agent_name}' is not a valid Python identifier")
        return

    agent_dir = agents_dir / agent_name
    if agent_dir.exists():
        click.echo(f"Error: Agent '{agent_name}' already exists")
        return

    try:
        agent_dir.mkdir()
        _create_agent_files(agent_dir, agent_name, framework)

        click.echo(f"Created {framework} agent: {agent_name}")
        click.echo(f"Location: {agent_dir}")

        track("cli_create_agent", {"framework": framework})

        click.echo("\nNext steps:")
        click.echo(f"  Edit agents/{agent_name}/agent.py to implement your logic")
        click.echo("  Run with: superserve up")
        click.echo(f"  Test at: POST http://localhost:8000/agents/{agent_name}/")

    except Exception as e:
        click.echo(f"Error: Failed to create agent: {e}")
        if agent_dir.exists():
            shutil.rmtree(agent_dir)


def _create_agent_files(agent_dir: Path, agent_name: str, framework: str):
    """Create the agent files with framework-specific templates."""
    (agent_dir / "__init__.py").write_text(f'"""Agent package for {agent_name}."""')

    if framework == "python":
        content = _get_python_template(agent_name)
    elif framework == "langchain":
        content = _get_langchain_template(agent_name)
    elif framework == "pydantic":
        content = _get_pydantic_template(agent_name)
    else:
        content = _get_python_template(agent_name)

    (agent_dir / "agent.py").write_text(content)


def _get_python_template(agent_name: str) -> str:
    """Get pure Python agent template."""
    return f'''"""Pure Python agent implementation for {agent_name}."""

import superserve
from superserve import Agent


@superserve.tool(num_cpus=1)
def example_tool(query: str) -> str:
    """Process a query and return a result."""
    return f"Processed: {{query}}"


class {agent_name.title().replace("_", "")}(Agent):
    """Agent implementation using pure Python."""

    tools = [example_tool]

    async def run(self, query: str) -> str:
        """Execute the agent.

        Args:
            query: User's input query

        Returns:
            Agent's response
        """
        # Example: Call a tool
        result = await self.call_tool("example_tool", query=query)
        return f"Agent response: {{result}}"


# Serve the agent
superserve.serve({agent_name.title().replace("_", "")}, name="{agent_name}", num_cpus=1, memory="2GB")
'''


def _get_langchain_template(agent_name: str) -> str:
    """Get LangChain agent template."""
    return f'''"""LangChain agent implementation for {agent_name}."""

import superserve
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI


@superserve.tool(num_cpus=1)
def example_tool(query: str) -> str:
    """Process a query and return a result."""
    return f"Processed: {{query}}"


def make_agent():
    """Create and configure the LangChain agent."""
    llm = ChatOpenAI(model="gpt-4o-mini")
    return create_agent(llm, tools=[example_tool])


# Serve the agent
superserve.serve(make_agent, name="{agent_name}", num_cpus=1, memory="2GB")
'''


def _get_pydantic_template(agent_name: str) -> str:
    """Get Pydantic AI agent template."""
    return f'''"""Pydantic AI agent implementation for {agent_name}."""

import superserve
from pydantic_ai import Agent


@superserve.tool(num_cpus=1)
def example_tool(query: str) -> str:
    """Process a query and return a result."""
    return f"Processed: {{query}}"


def make_agent():
    """Create and configure the Pydantic AI agent."""
    return Agent(
        "openai:gpt-4o-mini",
        system_prompt="You are a helpful assistant.",
        tools=[example_tool],
    )


# Serve the agent
superserve.serve(make_agent, name="{agent_name}", num_cpus=1, memory="2GB")
'''
