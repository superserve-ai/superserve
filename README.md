# Ray Agents
Experimental API for running LLM agents (LangGraph, CrewAI, etc.) with distributed tool execution on Ray.

**Note**: This is an experimental package and currently in active development.


## Features

- Distributed tool execution on Ray clusters
- Framework-agnostic agent adapters (LangGraph, etc.)
- **Code Interpreter**: Secure Python execution in gVisor-sandboxed environments (see [CODE_INTERPRETER.md](CODE_INTERPRETER.md))
- Session management with conversation history

## Quick Start

### Install gVisor (Required for Code Interpreter)

**macOS with Docker Desktop:**
```bash
make setup-gvisor-macos
# Then quit and restart Docker Desktop
make verify-gvisor
```

**Linux:**
```bash
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install
docker run --rm --runtime=runsc hello-world
```


## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
