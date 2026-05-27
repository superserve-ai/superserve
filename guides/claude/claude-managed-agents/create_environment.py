"""Create a self-hosted environment on Claude Platform."""
from __future__ import annotations

import os

import anthropic
import dotenv

dotenv.load_dotenv(override=True)

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

environment = client.beta.environments.create(
    name="superserve",
    config={"type": "self_hosted"},
)

print(f"created environment {environment.id}")
print()
print("next steps:")
print(f"  1. open https://platform.claude.com/workspaces/default/environments/{environment.id}")
print("  2. click 'Generate environment key'")
print("  3. add both values to .env:")
print(f"     ANTHROPIC_ENVIRONMENT_ID={environment.id}")
print("     ANTHROPIC_ENVIRONMENT_KEY=sk-ant-oat01-...")
