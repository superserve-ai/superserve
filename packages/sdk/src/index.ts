/**
 * Superserve SDK — sandbox infrastructure for running code in isolated cloud environments.
 *
 * @example
 * ```typescript
 * import { Sandbox } from "@superserve/sdk"
 *
 * const sandbox = await Sandbox.create({ name: "my-sandbox" })
 * await sandbox.waitForReady()
 *
 * const result = await sandbox.commands.run("echo hello")
 * console.log(result.stdout)
 *
 * await sandbox.files.write("/app/data.txt", "content")
 * const text = await sandbox.files.readText("/app/data.txt")
 *
 * await sandbox.kill()
 * ```
 *
 * @packageDocumentation
 */

export {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  SandboxError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "./errors.js"
export { Sandbox } from "./Sandbox.js"
export type {
  CommandOptions,
  CommandResult,
  ConnectionOptions,
  FileInput,
  NetworkConfig,
  SandboxCreateOptions,
  SandboxInfo,
  SandboxListOptions,
  SandboxStatus,
  SandboxUpdateOptions,
  SandboxWaitOptions,
} from "./types.js"
