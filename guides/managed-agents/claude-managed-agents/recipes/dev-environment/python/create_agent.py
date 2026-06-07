"""Create a long-lived coding assistant agent with sandbox tools enabled."""

from __future__ import annotations

import argparse
import os
import sys

import anthropic
import dotenv

dotenv.load_dotenv(override=True)

TOOLS = ["bash", "read", "write", "edit", "glob", "grep"]

SYSTEM = """\
You are a coding assistant with a persistent development environment at /workspace.
Your environment — installed packages, cloned repositories, build artifacts — survives between sessions.

At the start of every session:
1. Run: ls /workspace/ to see what's there
2. Read /workspace/.session-notes if it exists

After each session, update /workspace/.session-notes with:
- What repository is checked out and what branch
- What packages/tools are installed
- What you last worked on and what's next

This means: install dependencies once. Run tests instantly. Never re-clone.
Work carefully and test your changes before reporting completion.\
"""

parser = argparse.ArgumentParser(description="Create a Claude Dev Environment Agent.")
parser.add_argument(
    "name", help="Agent name (must be unique among non-archived agents)"
)
args = parser.parse_args()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

for existing in client.beta.agents.list():
    if existing.name == args.name and existing.archived_at is None:
        print(
            f"agent named {args.name!r} already exists: {existing.id}", file=sys.stderr
        )
        sys.exit(1)

agent = client.beta.agents.create(
    name=args.name,
    model="claude-sonnet-4-6",
    system=SYSTEM,
    tools=[
        {
            "type": "agent_toolset_20260401",
            "default_config": {
                "enabled": False,
                "permission_policy": {"type": "always_allow"},
            },
            "configs": [
                {
                    "name": t,
                    "enabled": True,
                    "permission_policy": {"type": "always_allow"},
                }
                for t in TOOLS
            ],
        }
    ],
)

print(f"created agent {agent.id} (name: {agent.name})")
