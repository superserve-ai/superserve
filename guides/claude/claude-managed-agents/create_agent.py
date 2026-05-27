"""Create a long-lived agent with sandbox tools enabled."""
from __future__ import annotations

import argparse
import os
import sys

import anthropic
import dotenv

dotenv.load_dotenv(override=True)

SANDBOX_TOOLS = ["bash", "read", "write", "edit", "glob", "grep"]
WEB_TOOLS = ["web_fetch", "web_search"]

parser = argparse.ArgumentParser(description="Create a Claude Managed Agent.")
parser.add_argument("name", help="Agent name (must be unique among non-archived agents)")
args = parser.parse_args()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

for existing in client.beta.agents.list():
    if existing.name == args.name and existing.archived_at is None:
        print(f"agent named {args.name!r} already exists: {existing.id}", file=sys.stderr)
        sys.exit(1)

agent = client.beta.agents.create(
    name=args.name,
    model="claude-sonnet-4-6",
    system="You have a working sandbox. Use your tools to do what is asked. Be terse.",
    tools=[
        {
            "type": "agent_toolset_20260401",
            "default_config": {"enabled": False, "permission_policy": {"type": "always_allow"}},
            "configs": [
                {"name": t, "enabled": True, "permission_policy": {"type": "always_allow"}}
                for t in SANDBOX_TOOLS + WEB_TOOLS
            ],
        }
    ],
)

print(f"created agent {agent.id} (name: {agent.name})")
