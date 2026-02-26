# Contributing to Superserve

Thank you for your interest in contributing to Superserve! We welcome contributions from the community.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) for TypeScript projects
- Python 3.12+ and [uv](https://github.com/astral-sh/uv) for the legacy Python CLI

### Development Setup

1. Fork the repository on GitHub.

2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/superserve.git
   cd superserve
   ```

3. Create a new branch for your changes:
   ```bash
   git checkout -b my-feature-branch
   ```

4. Install dependencies:
   ```bash
   bun install
   ```

5. Run a build to verify setup:
   ```bash
   bun run build
   ```

## Repo Structure

```
apps/playground/           # React + Vite playground app
packages/cli/              # TypeScript CLI (@superserve/cli)
packages/sdk/              # TypeScript SDK (@superserve/sdk)
packages/typescript-config/ # Shared tsconfig presets
packages/biome-config/     # Shared Biome config
src/superserve/            # Legacy Python CLI (being replaced)
```

## Common Commands

```bash
bun run build              # build all packages
bun run dev                # start all dev servers
bun run lint               # lint all packages
bun run typecheck          # type check all packages
bun run test               # run all tests
```

For a single package:
```bash
bunx turbo run dev --filter=@superserve/playground
```

For the legacy Python CLI:
```bash
uv sync --dev
uv run pytest
uv run ruff check . --fix
uv run mypy src/superserve
```

## How to Contribute

### Reporting Bugs

- Check existing [issues](https://github.com/superserve-ai/superserve/issues) to avoid duplicates
- Use a clear, descriptive title
- Include steps to reproduce the issue
- Provide relevant environment details (OS, runtime version, etc.)

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case and expected behavior
- Explain why this would be useful to other users

### Pull Requests

1. Create a branch from `main`

2. Make your changes and write tests if applicable

3. Ensure all checks pass:
   ```bash
   bun run lint
   bun run typecheck
   bun run test
   bun run build
   ```

4. Commit with a clear message:
   ```bash
   git commit -m "feat: add your feature description"
   ```

5. Push and open a Pull Request

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `refactor:` - Code changes that neither fix bugs nor add features
- `chore:` - Maintenance tasks

## Code Style

- [Biome](https://biomejs.dev/) for TypeScript linting and formatting
- [Ruff](https://github.com/astral-sh/ruff) for Python linting and formatting
- [mypy](https://mypy-lang.org/) for Python type checking
- Type hints are encouraged in both TypeScript and Python

## Questions?

Feel free to open an issue for any questions or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the Open Core Ventures Source Available License (OCVSAL) 1.0.
