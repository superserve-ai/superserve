# RayAI Agent Project

A template for building and deploying agents with Ray Serve using the RayAI CLI.

## Quick Start

1. **Create a new project:**
   ```bash
   rayai init <project_name>
   cd <project_name>
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment (optional):**
   ```bash
   # Create .env file with your API keys and configuration
   ```

4. **Create your first agent:**
   ```bash
   rayai create-agent <agent_name>
   ```

5. **Implement your agent logic:**
   ```bash
   # Edit agents/<agent_name>/agent.py
   # - Add initialization code in __init__()
   # - Implement your logic in run()
   ```

6. **Deploy your agents:**
   ```bash
   rayai serve
   ```

7. **Test your agent:**
   ```bash
   curl -X POST http://localhost:8000/agents/<agent_name>/chat \
     -H "Content-Type: application/json" \
     -d '{"data": {"input": "test"}, "session_id": "test"}'
   ```

## Available Commands

- **`rayai create-agent <name>`** - Create a new agent
- **`rayai serve`** - Deploy all agents
- **`rayai serve --agents agent1,agent2`** - Deploy specific agents
- **`rayai serve --port=9000`** - Deploy on custom port
- **`rayai serve --<agent-name>-num-cpus=4`** - Override CPU allocation
- **`rayai serve --<agent-name>-num-gpus=1`** - Override GPU allocation
- **`rayai serve --<agent-name>-memory=8GB`** - Override memory allocation
- **`rayai serve --<agent-name>-num-replicas=2`** - Set number of replicas

## API Endpoints

After running `rayai serve`, each agent gets its own endpoint:

- **POST /agents/{agent_name}/chat** - Main agent endpoint
- **GET /docs** - Interactive API documentation
- **Ray Dashboard:** http://localhost:8265

## Project Structure

```
my-project/
├── requirements.txt
├── .env                    # Optional API keys
└── agents/                 # All your agents
    ├── chatbot/
    │   ├── __init__.py
    │   └── agent.py        # ChatbotAgent class
    ├── analyzer/
    │   ├── __init__.py
    │   └── agent.py        # AnalyzerAgent class
    └── ...
```

## Agent Implementation

Each agent must inherit from `RayAgent` and implement the `run()` method:

```python
from ray_agents import RayAgent

class ChatbotAgent(RayAgent):
    def __init__(self):
        super().__init__()
        # Add your initialization code here
        # - Load models
        # - Initialize clients
        # - Set up databases
    
    def run(self, data: dict) -> dict:
        # Implement your agent logic here
        # Called for every request to /agents/chatbot/chat
        # - Process the input data
        # - Return results as a dictionary
        return {"response": "Hello!"}
```

## Resource Configuration

Configure CPU, GPU, memory, and replicas for your agents using two methods:

### Method 1: Ray Decorator (Set Defaults in Code)

Use the `@ray.remote` decorator to set default resource requirements for your agent:

```python
import ray
from ray_agents import RayAgent

@ray.remote(num_cpus=2, num_gpus=0, memory=4 * 1024**3)
class MyAgent(RayAgent):
    def __init__(self):
        super().__init__()

    def run(self, data: dict) -> dict:
        return {"response": "Hello!"}
```

**Note:** The `memory` argument requires bytes (e.g., `4 * 1024**3` for 4GB).

### Method 2: CLI Flags (Runtime Overrides)

Override resource settings at runtime using CLI flags:

```bash
rayai serve --my-agent-num-cpus=4 --my-agent-memory=8GB --my-agent-num-replicas=2
```

Available resource flags:
- `--{agent-name}-num-cpus` - Number of CPUs (integer)
- `--{agent-name}-num-gpus` - Number of GPUs (integer)
- `--{agent-name}-memory` - Memory allocation (supports "4GB", "512MB", etc.)
- `--{agent-name}-num-replicas` - Number of replicas for load balancing (integer)

### Precedence

When resources are configured in multiple places, the following precedence applies:

**CLI flags > @ray.remote decorator > defaults**

Default resources: 1 CPU, 2GB memory, 1 replica, 0 GPUs

## Development Workflow

1. **Create agent:** `rayai create-agent my-agent`
2. **Edit logic:** Modify `agents/my-agent/agent.py`
3. **Test locally:** `rayai serve`
4. **Make requests:** `POST /agents/my-agent/chat`
5. **Iterate:** Edit code, restart serve, test