"""
Synthetic Data Generator Agent

Generates fake datasets using sandboxed Python execution.

Usage:
    cd examples/data_generator
    rayai up

Test:
    curl -X POST http://localhost:8000/agents/data_generator/ \
      -H "Content-Type: application/json" \
      -d '{"query": "Generate 50 customer records with name, email, signup date"}'
"""

from pydantic_ai import Agent

import rayai
from rayai.sandbox import Sandbox

SYSTEM_PROMPT = """You are a synthetic data generator. Write Python code to generate fake datasets.

When users describe data they need:
1. Write Python code using pandas, numpy, and faker
2. Use run_code to execute it, passing the session_id for persistence
3. Save results to /tmp/<name>.csv
4. Show a preview (first 10 rows)

Available: pandas, numpy, faker
Variables persist across calls within the same session_id.
Always pass session_id to run_code for session persistence.
"""

DOCKERFILE = """
FROM python:3.12-slim
RUN pip install --no-cache-dir pandas numpy faker
"""

sandbox = Sandbox(dockerfile=DOCKERFILE, timeout=120)


def make_agent():
    return Agent(
        "openai:gpt-4o-mini",
        system_prompt=SYSTEM_PROMPT,
        tools=[sandbox.run_code, sandbox.bash],
    )


rayai.serve(make_agent, name="data_generator", num_cpus=1, memory="2GB")
