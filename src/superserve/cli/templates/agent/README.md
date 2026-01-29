# {{PROJECT_NAME}}

Built with [Agentic Ray](https://github.com/superserve-labs/agentic-ray).

## Quick Start

1. **Install:**
   ```bash
   pip install superserve
   ```

2. **Create a new project:**
   ```bash
   superserve init my_project
   cd my_project
   ```

3. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. **Create an agent:**
   ```bash
   superserve create-agent my_agent
   ```

5. **Run your agent:**
   ```bash
   superserve up
   ```

## API Endpoints

After running `superserve up`, your agents are available at:

- **POST** `/agents/{agent_name}/` - Call your agent

### Example Request

```bash
curl -X POST http://localhost:8000/agents/my_agent/ \
  -H "Content-Type: application/json" \
  -d '{"query": "Hello!"}'
```
