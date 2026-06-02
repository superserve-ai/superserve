# Recipe: Parallel Benchmark Agent

## What it is

A Claude Managed Agent that benchmarks code across multiple configurations simultaneously. The agent writes a parallel harness that spins up N isolated Superserve sandboxes — one per variant — runs them all concurrently, collects timing results, and synthesizes a comparison report.

**The core pitch:** Benchmarking 9 configurations sequentially takes 9× longer than benchmarking them in parallel. Superserve sandboxes boot in under a second and run truly isolated. The agent drives all of this autonomously.

---

## Why it's differentiated

This recipe is mechanically distinct from the other two. The orchestrator pattern is nearly the same as the base, but the agent itself creates additional sandboxes during its work — hierarchical sandbox usage.

### vs. running benchmarks in one sandbox

A single sandbox with 4 vCPUs can parallelize across threads, but:
- Variants share CPU, memory, and OS state — results are noisy
- Python's GIL prevents true CPU-parallelism for Python benchmarks
- You can't test "clean environment with only numpy 1.x" vs. "clean environment with numpy 2.x"

Superserve gives you **true isolation per variant**: separate VM, separate kernel, separate filesystem, no shared state. Results are clean.

### vs. running variants sequentially

If each variant takes 30 seconds, 9 variants = 4.5 minutes sequentially. With parallel sandboxes: still 30 seconds total. The agent reasons about this and chooses the parallel approach by default.

### Agent-driven parallelism

The agent doesn't just run a benchmark — it *designs* the benchmark matrix, decides how many variants to test, writes the parallel harness, manages the sub-sandbox lifecycle, and synthesizes the results. The user just says "benchmark quicksort vs mergesort on 1M integers."

---

## How it works

```
User: "Benchmark bubble sort, quicksort, and Python's built-in sort 
       on 10k, 100k, and 1M random integers. 3 trials each."

Agent reasoning:
  → 3 algorithms × 3 sizes = 9 variants
  → writes /workspace/benchmark.py (harness + sort implementations)
  → writes /workspace/run_parallel.py (creates 9 sandboxes via asyncio.gather)
  → runs: python3 /workspace/run_parallel.py
  
run_parallel.py (agent-authored):
  → asyncio.gather(create sandbox × 9)     ← 9 sandboxes boot in ~1s each
  → asyncio.gather(upload + run × 9)       ← all 9 run simultaneously
  → asyncio.gather(collect results × 9)
  → asyncio.gather(kill × 9)
  → writes /workspace/results.md

Agent reads results.md, synthesizes:
  → "Python's built-in sort (Timsort) is 40× faster than bubble sort 
     at 1M elements. Quicksort is 15× faster. Here's the full table..."
```

Total time for 9 variants: ~35 seconds (dominated by the slowest benchmark run, not the sum).

---

## Implementation

### Template (`claude-benchmark-agent`)
- Base: `python:3.12-slim`
- System deps: `curl git jq procps`
- Python packages: `anthropic superserve` — **superserve is the key addition**; the agent uses it from bash to create sub-sandboxes
- Resources: 2 vCPU / 2048 MiB (the controller sandbox is lightweight; compute happens in sub-sandboxes)

### Agent
- **Model:** `claude-sonnet-4-6`
- **Tools:** `bash`, `read`, `write` (no web tools — benchmarks are self-contained)
- **System prompt:**
  ```
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

  Keep variant count ≤ 20. Always kill sub-sandboxes — never leave them running.
  Sub-sandboxes should use from_template=None (platform default) unless the benchmark 
  requires specific packages.
  ```

### Orchestrator changes from base
Two changes only:

1. **Network config** — allow `api.superserve.ai` so the agent can call the Superserve API:
   ```python
   network=NetworkConfig(allow_out=["api.anthropic.com", "api.superserve.ai"])
   ```

2. **Runner environment** — pass `SUPERSERVE_API_KEY`:
   ```python
   env={
       "ANTHROPIC_ENVIRONMENT_KEY": ENVIRONMENT_KEY,
       "ANTHROPIC_WORK_ID": work.id,
       "ANTHROPIC_SESSION_ID": session_id,
       "ANTHROPIC_ENVIRONMENT_ID": ENVIRONMENT_ID,
       "SUPERSERVE_API_KEY": os.environ["SUPERSERVE_API_KEY"],  # ← new
   }
   ```

### Runner
- Identical to base

---

## What to show in the README / docs

**Lead with the agent-authored harness.** Show what the agent actually writes — this is the "aha" moment:

```python
# Agent writes this to /workspace/run_parallel.py
import asyncio, os
from superserve import AsyncSandbox

VARIANTS = [
    ("bubble_sort",  10_000), ("bubble_sort",  100_000), ("bubble_sort",  1_000_000),
    ("quicksort",    10_000), ("quicksort",    100_000), ("quicksort",    1_000_000),
    ("builtin_sort", 10_000), ("builtin_sort", 100_000), ("builtin_sort", 1_000_000),
]

async def run_variant(algo, size):
    sandbox = await AsyncSandbox.create(name=f"bench-{algo}-{size}")
    await sandbox.files.write("/bench.py", open("/workspace/benchmark.py").read())
    result = await sandbox.commands.run(f"python3 /bench.py {algo} {size}")
    await sandbox.kill()
    return {"algo": algo, "size": size, "output": result.stdout}

results = await asyncio.gather(*[run_variant(a, s) for a, s in VARIANTS])
# write results.md ...
```

**Then show the timing comparison:** 9 variants × 30s each = 4.5 minutes sequentially; parallel = 32 seconds.

**Note sub-sandbox billing:** Sub-sandboxes accrue charges while running. The harness always kills them. Typical benchmark run: < 2 minutes per sub-sandbox.

---

## Files to create

```
guides/claude/parallel-benchmark-agent/
├── README.md
├── python/
│   ├── .env.example
│   ├── pyproject.toml
│   ├── build_template.py     ← adds superserve to pip install
│   ├── create_agent.py       ← bash/read/write only; benchmark-focused system prompt
│   ├── orchestrator.py       ← +api.superserve.ai network, +SUPERSERVE_API_KEY env
│   └── runner.py             ← identical to base
└── typescript/
    ├── .env.example
    ├── package.json
    ├── build-template.mjs    ← adds superserve to pip install (runner is still Python)
    ├── create-agent.mjs      ← same tools/prompt as Python version
    └── orchestrator.mjs      ← same two changes as Python orchestrator
```

```
docs/integrations/managed-agents/parallel-benchmark-agent.mdx
```

---

## Positioning note

This recipe is the **technical showpiece** — it's the one that's hardest to replicate on other platforms and most clearly demonstrates Superserve's architecture. Lead with the timing comparison (parallel vs. sequential). The hierarchical sandbox pattern (agent creates sandboxes) is a power-user feature worth calling out explicitly.

One risk to address in docs: sub-sandbox billing. Make it clear the harness cleans up after itself and show approximately how much a typical benchmark run costs (e.g., "9 sandboxes × 30s each ≈ 4.5 sandbox-minutes").
