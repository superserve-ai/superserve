# superserve

Ruby SDK for the Superserve sandbox API — run code in isolated Firecracker MicroVMs.

## Installation

Add to your Gemfile:

```ruby
gem "superserve"
```

Or install directly:

```bash
gem install superserve
```

Requires Ruby ≥ 3.2.

## Quick Start

```ruby
require "superserve"

sandbox = Superserve::Sandbox.create(name: "my-sandbox")

result = sandbox.commands.run("echo hello")
puts result.stdout

sandbox.files.write("/app/data.txt", "content")
text = sandbox.files.read_text("/app/data.txt")

sandbox.kill
```

## Authentication

Set the `SUPERSERVE_API_KEY` environment variable:

```bash
export SUPERSERVE_API_KEY=ss_live_...
```

Or pass it explicitly:

```ruby
sandbox = Superserve::Sandbox.create(
  name: "my-sandbox",
  api_key: "ss_live_...",
  base_url: "https://api.superserve.ai" # optional
)
```

## Streaming command output

```ruby
result = sandbox.commands.run(
  "pip install numpy",
  on_stdout: ->(data) { print data },
  on_stderr: ->(data) { warn data },
  timeout_seconds: 120
)
```

Passing `on_stdout:` or `on_stderr:` switches the call to streaming mode (SSE).
The block returns the aggregated `CommandResult` once the command finishes.

## Templates

```ruby
template = Superserve::Template.create(
  name: "my-python-env",
  from: "python:3.11",
  steps: [{ run: "pip install numpy" }]
)
template.wait_until_ready

sandbox = Superserve::Sandbox.create(name: "run-1", from_template: template)
```

## Error handling

```ruby
begin
  sandbox.pause
rescue Superserve::ConflictError
  # Sandbox is not in a pausable state
rescue Superserve::AuthenticationError
  # 401 / 403
rescue Superserve::NotFoundError
  # 404
rescue Superserve::RateLimitError => e
  # 429 — e.code distinguishes: rate_limited, too_many_sandboxes, etc.
rescue Superserve::TimeoutError
  # Request timed out
rescue Superserve::SandboxError
  # Catch-all base class
end
```

## Full documentation

[docs.superserve.ai](https://docs.superserve.ai/sdk/ruby/sandbox)

## Development

```bash
# From repo root:
bunx turbo run test --filter=@superserve/ruby-sdk

# Or directly:
cd packages/ruby-sdk
bundle install
bundle exec rspec
```

## License

Apache License 2.0.
