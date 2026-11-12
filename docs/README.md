# Superserve Docs

Documentation for [Superserve](https://superserve.ai?utm_source=github&utm_medium=readme). Published at [docs.superserve.ai](https://docs.superserve.ai?utm_source=github&utm_medium=readme).

## Local development

```bash
npx mint dev # or bunx mint dev
```

Preview at `http://localhost:3000`.

## Structure

```
docs/
├── docs.json              # Mintlify config and navigation
├── introduction.mdx       # Introduction
├── logos/                 # Logos
└── favicon.svg            # Favicon
```

## API reference

The API reference pages load the OpenAPI spec from https://api.superserve.ai/openapi.yaml (`openapi` in `docs.json`). The sandbox repository serves it from `api/openapi.yaml`. The spec and these pages are public: they must not contain internal endpoints (`/internal/**`), secrets, tokens, internal hostnames or IPs, infrastructure details, or other sensitive data.

`bun run docs:check-nav` (from the repo root) checks that the API reference navigation in `docs.json` matches the spec.

## Publishing

Changes pushed to the default branch are deployed automatically via the [Mintlify GitHub app](https://dashboard.mintlify.com).
