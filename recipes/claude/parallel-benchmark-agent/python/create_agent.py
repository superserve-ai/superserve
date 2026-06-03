"""Create a benchmarking agent that runs variants in parallel sub-sandboxes."""

from __future__ import annotations

import argparse
import os
import sys

import anthropic
import dotenv

dotenv.load_dotenv(override=True)

TOOLS = ["bash", "read", "write"]

SYSTEM = """\
You are a benchmarking agent. The Superserve Python SDK is installed in your sandbox.

When asked to benchmark code:
1. Design the variant matrix (algorithm × parameter × size)
2. Write the benchmark script at /workspace/benchmark.py
3. Write a parallel harness at /workspace/run_parallel.py that:
   - Uses asyncio + AsyncSandbox to create one sandbox per variant
   - Uploads benchmark.py to each, runs it, collects stdout
   - Kills all sub-sandboxes when done
   - Writes a results table to /workspace/results.md
4. Run: SUPERSERVE_API_KEY=$SUPERSERVE_API_KEY python3 /workspace/run_parallel.py
5. Read results.md and report the comparison with a clear winner

Keep variant count <= 20. Always kill sub-sandboxes — never leave them running.
Sub-sandboxes should use from_template=None (platform default) unless the benchmark
requires specific packages.\
"""

parser = argparse.ArgumentParser(
    description="Create a Claude Parallel Benchmark Agent."
)
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
