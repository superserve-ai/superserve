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

/** Cap stdout returned to the model (bytes); larger output is truncated head+tail. */
export const MAX_STDOUT_BYTES = 32 * 1024

/** Cap stderr returned to the model (bytes); larger output is truncated head+tail. */
export const MAX_STDERR_BYTES = 32 * 1024

/** Cap inline file content returned by `sandbox_files_read` (bytes). */
export const MAX_FILE_BYTES = 1024 * 1024
