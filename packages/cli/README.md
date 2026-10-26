# Superserve CLI

Create sandboxes, run commands, move files and publish ports from your terminal. Built on [`@superserve/sdk`](https://www.npmjs.com/package/@superserve/sdk).

## Install

```bash
npm install -g @superserve/cli                    # Node.js 22.4 or later
curl -fsSL https://superserve.ai/install | sh     # standalone binary, macOS and Linux
brew install superserve-ai/tap/superserve         # Homebrew
```

The install script puts the binary in `~/.superserve/bin` (override with `SUPERSERVE_INSTALL_DIR`) and installs the latest release unless `SUPERSERVE_VERSION` is set.

## Authenticate

```bash
superserve login          # signs in (or up) in the browser and saves a key to ~/.superserve/credentials.json
superserve whoami         # shows the key in use and checks it
```

In CI, set `SUPERSERVE_API_KEY` instead; it takes precedence over the saved key.

## Quickstart

```bash
superserve sandbox create --name demo --template superserve/python-3.11
superserve exec demo -- python3 -c "print('hello')"
superserve cp ./app demo:/home/user/app
superserve exec demo "cd /home/user/app && nohup python3 -m http.server 3000 >/dev/null 2>&1 &"
superserve preview publish demo 3000 --open
superserve shell demo
superserve sandbox pause demo
superserve sandbox delete demo
```

Commands that take a sandbox accept its ID or its exact name.

## Commands

| Command                     | Subcommands                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `sandbox`                   | `create`, `list`, `get`, `update`, `pause`, `resume`, `delete`, `network-log`             |
| `exec`                      | Run a command in a sandbox; exits with the command's exit code                            |
| `shell`                     | Open an interactive shell in a sandbox                                                    |
| `files`                     | `ls`, `cat`, `write`, `upload`, `download`                                                |
| `cp`                        | Copy files between your machine and a sandbox (`<sandbox>:<path>`)                        |
| `preview`                   | `list`, `publish`, `unpublish`, `url`, `token`, `rotate`                                  |
| `snapshot`                  | `create`, `list`, `get`, `rename`, `delete`, `wait`                                       |
| `template`                  | `create`, `list`, `get`, `delete`, `rebuild`, `builds`, `build`, `cancel`, `logs`, `wait` |
| `secret`                    | `create`, `list`, `get`, `rotate`, `delete`, `audit`, `sandboxes`, `attach`, `detach`     |
| `provider`                  | `list`                                                                                    |
| `login`, `logout`, `whoami` | Manage the saved API key                                                                  |
| `completion`                | Print a `bash`, `zsh`, `fish` or `powershell` completion script                           |

Run `superserve <command> --help` for options and examples.

## JSON output

Add `--json` to any command that returns data for machine-readable output on stdout. Commands that stream raw bytes or take over the terminal (`files cat`, `files download -`, `shell`, `completion`) ignore it. Progress and errors go to stderr, so pipes only ever see data:

```bash
superserve sandbox list --json | jq -r '.[].id'
```

With `--json`, errors are printed to stderr as `{"error": {"message", "code", "status"}}`.

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | Success                                              |
| 1    | Error                                                |
| 2    | Invalid usage or arguments                           |
| 3    | Not logged in, or the API key was rejected           |
| 4    | Not found                                            |
| 5    | Conflict (for example, the sandbox is still pausing) |
| 6    | Rate limited                                         |
| 7    | Timed out                                            |
| 130  | Interrupted                                          |

`superserve exec` exits with the remote command's own exit code.

## Environment variables

| Variable                | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `SUPERSERVE_API_KEY`    | API key; overrides the saved key                       |
| `SUPERSERVE_BASE_URL`   | Control-plane URL override                             |
| `SUPERSERVE_CONFIG_DIR` | Where credentials are stored (default `~/.superserve`) |
| `SUPERSERVE_TELEMETRY`  | Set to `0` to disable usage telemetry                  |
| `DO_NOT_TRACK`          | Set to `1` to disable usage telemetry                  |
| `SUPERSERVE_DEBUG`      | Set to `1` to print stack traces on errors             |

## Telemetry

The CLI sends one anonymous event per command: the command name (for example `sandbox create`), its exit code and duration, the CLI version, OS, CPU architecture, runtime and whether it ran in CI, keyed by a random ID stored in the config directory. It never sends arguments, sandbox IDs, file paths, output or your API key. Disable it with `SUPERSERVE_TELEMETRY=0` or `DO_NOT_TRACK=1`.

## Development

```bash
bun src/index.ts --help          # run from source
bun test                         # tests
bun run build                    # dist/index.js (the npm package)
bun run build:binaries           # dist/index.js plus standalone binaries
```

Releases are cut by pushing a `cli-vX.Y.Z` tag.

## License

MIT
