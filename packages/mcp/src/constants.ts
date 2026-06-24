/**
 * Server identity and output-shaping limits for the Superserve MCP server.
 */

/** MCP server name advertised in the initialize handshake. */
export const SERVER_NAME = "superserve"

/**
 * Server version. Kept in sync with `package.json` `version`
 * (enforced by `tests/version.test.ts`).
 */
export const SERVER_VERSION = "0.1.0"

/** Default per-command timeout when a tool call omits `timeout_ms`. */
export const DEFAULT_EXEC_TIMEOUT_MS = 60_000

/**
 * Hard ceiling on a single `sandbox_exec` command timeout (ms). A caller cannot
 * ask the hosted server to hold a request open longer than this, which would
 * otherwise tie up serverless/container concurrency until an outer timeout wins.
 */
export const MAX_EXEC_TIMEOUT_MS = 10 * 60_000

/** Cap stdout returned to the model (bytes); larger output is truncated head+tail. */
export const MAX_STDOUT_BYTES = 32 * 1024

/** Cap stderr returned to the model (bytes); larger output is truncated head+tail. */
export const MAX_STDERR_BYTES = 32 * 1024

/**
 * Hard cap on a single `sandbox_files_read` download (bytes). The SDK defaults
 * to a 2 GiB ceiling; the MCP server reads with this much smaller cap so a
 * hostile or accidental large file (logs, artifacts, archives) cannot balloon
 * the hosted, multi-tenant process memory. Files larger than this are rejected
 * with guidance to read a slice via `sandbox_exec`.
 */
export const MAX_FILE_BYTES = 1024 * 1024

/**
 * Max decoded bytes accepted by `sandbox_files_write` (inline content). Inline
 * tool-call content is for code, config, and small assets; larger transfers
 * belong on the SDK/CLI upload path, not a JSON-RPC body held in memory.
 */
export const MAX_WRITE_BYTES = 8 * 1024 * 1024

/**
 * Max JSON-RPC request body the hosted HTTP server will buffer (bytes). Sized
 * above {@link MAX_WRITE_BYTES} (base64 expands ~4/3) so a legitimate max-size
 * write still fits, while an authenticated-but-untrusted caller cannot exhaust
 * memory with a giant body before tool validation runs.
 */
export const MAX_REQUEST_BYTES = 16 * 1024 * 1024
