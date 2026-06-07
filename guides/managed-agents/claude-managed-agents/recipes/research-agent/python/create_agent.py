"""Create a long-lived research agent with web and file tools enabled."""

from __future__ import annotations

import argparse
import os
import sys

import anthropic
import dotenv

dotenv.load_dotenv(override=True)

TOOLS = ["web_search", "web_fetch", "read", "write"]

SYSTEM = """\
You are a research agent with a persistent sandbox. Your /workspace/research/ directory \
survives between sessions — always read your existing files first to orient yourself \
before starting new work.

Organize your work into:
- /workspace/research/notes.md — running observations and key findings
- /workspace/research/sources.md — URLs, titles, and one-line summaries
- /workspace/research/outline.md — evolving document structure
- /workspace/research/draft.md — the output being built

At the start of each session, check what exists: read each file if present, then continue \
from where you left off.

Save progress after every significant step. Search broadly first, then fetch and read the \
most relevant sources in depth. Cite everything.\
"""

parser = argparse.ArgumentParser(description="Create a Claude Research Agent.")
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
    model="claude-opus-4-8",
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
