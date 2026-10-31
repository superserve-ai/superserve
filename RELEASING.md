# Releasing

How to publish new versions of the Superserve SDKs, CLI, and MCP server.

## TypeScript SDK to npm

From the repo root:

```bash
# 1. Bump the version in BOTH places (keep them identical):
#    - packages/sdk/package.json
#    - packages/sdk/src/http.ts → SDK_VERSION (feeds the User-Agent)
# 2. Build + publish
bunx turbo run build --filter=@superserve/sdk
cd packages/sdk
NPM_CONFIG_TOKEN=npm_... bun publish --access public
```

Or with `.env.release` sourced:

```bash
source .env.release
bunx turbo run build --filter=@superserve/sdk
cd packages/sdk && bun publish --access public
```

## Python SDK to PyPI

**Important:** `uv build` must run from the **repo root** (uv workspaces put artifacts in root `dist/`). Bump the version in three places (keep them identical):

1. `packages/python-sdk/pyproject.toml` → `version = "..."`
2. `packages/python-sdk/src/superserve/__init__.py` → `__version__ = "..."`
3. `packages/python-sdk/src/superserve/_http.py` → `SDK_VERSION = "..."` (feeds the User-Agent)

```bash
uv build --package superserve
UV_PUBLISH_TOKEN=pypi-... uv publish dist/superserve-<version>*
```

Or with `.env.release` sourced:

```bash
source .env.release
uv build --package superserve
uv publish dist/superserve-*
```

## Release environment setup

Copy `.env.release.example` to `.env.release`, fill in tokens, and `source` it before running publish commands. `.env.release` is gitignored.

| Env variable       | Used by                   | How to get it                                                                             |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------- |
| `NPM_CONFIG_TOKEN` | `bun publish` (TS SDK)    | [npmjs.com](https://www.npmjs.com) → account → access tokens → automation token           |
| `UV_PUBLISH_TOKEN` | `uv publish` (Python SDK) | [pypi.org](https://pypi.org/manage/account/) → account → API tokens (starts with `pypi-`) |

## CI workflows (GitHub Actions)

| Workflow               | Trigger                                                     | Action                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Release SDKs**       | Manual (`workflow_dispatch`)                                | Sets the version, builds, publishes to npm and/or PyPI, and pushes the tag `@superserve/sdk@<version>` and/or `superserve-py@<version>`. Inputs: `package` (`ts` / `python` / `both`), `version`.       |
| **Publish CLI**        | Push of a `cli-v<version>` tag                              | Builds the CLI and standalone binaries, creates the GitHub release (generated notes, binaries, `SHA256SUMS`), publishes `@superserve/cli` to npm, and updates the `superserve-ai/homebrew-tap` formula. |
| **Publish MCP Server** | Push of an `mcp-v<version>` tag, or manual with a `version` | Pins `@superserve/sdk` to the published version, publishes `@superserve/mcp` to npm, and registers `server.json` in the MCP Registry.                                                                   |

`main` is protected, so the workflows never push commits. Merge any version bump to `main` in a PR before you run a workflow or push a tag.

npm and PyPI publishing in CI uses Trusted Publishing (OIDC), so these workflows need no npm or PyPI token secrets. The PyPI job runs in the `pypi` environment, which must match the PyPI trusted publisher.

### SDKs

1. Bump the version in the files listed above, and merge that change to `main`.
2. Run **Release SDKs** with the same `version`.

### CLI

The workflow takes the version from the tag, so `packages/cli/package.json` does not need a bump.

```bash
git tag cli-v<version> <commit-on-main>
git push origin cli-v<version>
```

The Homebrew step uses the repo secrets `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` (a GitHub App with write access to `superserve-ai/homebrew-tap`). The **CLI release check** workflow checks this credential on CLI pull requests and every week. The workflow is safe to re-run for the same tag.

### MCP server

1. Bump the version in `packages/mcp/package.json`, `packages/mcp/server.json` (both `version` fields), and `packages/mcp/src/constants.ts` → `SERVER_VERSION`, and merge that change to `main`. `tests/version.test.ts` checks that `SERVER_VERSION` matches `package.json`.
2. Publish the SDK first if the server needs a newer `@superserve/sdk`. The workflow fails if the published SDK is older than its `MIN_SDK_VERSION`.
3. Push the tag:

```bash
git tag mcp-v<version> <commit-on-main>
git push origin mcp-v<version>
```
