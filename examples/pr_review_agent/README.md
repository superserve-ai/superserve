# A PR Review Agent

A Github PR Review Agent that provides comprehensive summary and suggestions on code changes.

## Setup

1. Copy `.env.example` to `.env` and add your API keys:
   ```bash
   cp .env.example .env
   ```

2. Required API keys:
   - `OPENAI_API_KEY` - [OpenAI](https://platform.openai.com/)
   - `GITHUB_TOKEN` - [Github](https://github.com/settings/tokens)

## Quick Start

1. **Install:**
   ```bash
   pip install agentic-ray
   ```

2. **Create a new project:**
   ```bash
   rayai init my_project
   cd my_project
   ```

3. **Create an agent:**
   ```bash
   rayai create-agent my_agent
   ```

4. **Run your agent:**
   ```bash
   rayai serve
   ```

## API Endpoints

After running `rayai serve`, your agents are available at:

- **POST** `/agents/{agent_name}/chat` - Call your agent

### Example Request

```bash
curl -X POST http://localhost:8000/agents/my_agent/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Review https://github.com/{xxx}/{yyy}/pull/{123}"}]}'
```

## Tools

- `fetch_pull_request` - Fetch the details of PR
- `review_file` - Analyzes the changes made in each file
