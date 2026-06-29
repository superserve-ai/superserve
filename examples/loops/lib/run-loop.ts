import { Sandbox } from "@superserve/sdk"

/**
 * Everything a loop needs to bootstrap ONCE and then tick warm inside a single
 * persistent sandbox. This is the whole point of running loops on Superserve:
 * the expensive `setup` (clone + install + auth) happens only on first create;
 * every later tick resumes the warm box and runs `iterate` alone.
 */
export interface LoopSpec {
  /** Stable identity; used for metadata-based discovery of this loop's box. */
  name: string
  /** Tag the box so we can rediscover it next tick (e.g. `{ loop, repo }`). */
  metadata: Record<string, string>
  /** Template to boot from on first create. Defaults to `superserve/base`. */
  template?: string
  /** Team-stored secrets bound to env vars: `{ ENV_VAR: secretName }`. The
   *  real value never enters the box — a proxy token is swapped in at egress. */
  secrets?: Record<string, string>
  /** Non-sensitive env vars injected into the box. */
  envVars?: Record<string, string>
  /** Egress allow/deny lists. Omit for the platform default (open egress). */
  network?: { allowOut?: string[]; denyOut?: string[] }
  /** Files written INTO the box on first create (absolute path -> contents). */
  uploads?: Record<string, string>
  /** Runs ONCE, only when the box is first created (after uploads). */
  setup: string
  /** Runs EVERY tick, inside the warm box. */
  iterate: string
  /** Pause the box after the tick to stop compute billing. Defaults to true. */
  pauseWhenDone?: boolean
}

export interface RunResult {
  sandboxId: string
  /** True when this tick created + bootstrapped a fresh box (the cold start). */
  bootstrapped: boolean
  exitCode: number
  stdout: string
}

/** The live-box surface the spine drives — a subset of `Sandbox`, so an
 *  in-memory fake can stand in for it in tests. */
export interface SandboxHandle {
  readonly id: string
  files: { write(path: string, content: string): Promise<void> }
  commands: {
    run(
      command: string,
      options?: {
        cwd?: string
        env?: Record<string, string>
        timeoutMs?: number
        onStdout?: (data: string) => void
        onStderr?: (data: string) => void
      },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>
  }
  pause(): Promise<void>
}

/** The sandbox operations the spine needs. Injectable so tests can fake them. */
export interface SandboxOps {
  list(metadata: Record<string, string>): Promise<Array<{ id: string }>>
  connect(id: string): Promise<SandboxHandle>
  create(options: {
    name: string
    metadata: Record<string, string>
    fromTemplate?: string
    secrets?: Record<string, string>
    envVars?: Record<string, string>
    network?: { allowOut?: string[]; denyOut?: string[] }
  }): Promise<SandboxHandle>
}

/** Default ops backed by the real `@superserve/sdk`. */
export const sdkOps: SandboxOps = {
  list: (metadata) => Sandbox.list({ metadata }),
  connect: (id) => Sandbox.connect(id),
  create: (options) => Sandbox.create(options),
}

/** A loop tick can run a full agent harness; give it generous headroom. */
const ITERATE_TIMEOUT_MS = 20 * 60_000

/**
 * The reusable loop spine.
 *
 * Finds this loop's box by `metadata`. On the FIRST run there is no box, so it
 * creates one, uploads the work scripts, and runs `setup` exactly once. On every
 * later run the box already exists, so it resumes the warm box (repo + deps + the
 * agent harness all still there) and runs `iterate` only. The box is paused after.
 */
export async function runLoop(
  spec: LoopSpec,
  ops: SandboxOps = sdkOps,
  log: (line: string) => void = (line) => {
    process.stdout.write(line)
  },
): Promise<RunResult> {
  const [existing] = await ops.list(spec.metadata)
  const bootstrapped = existing === undefined
  const box = bootstrapped
    ? await ops.create({
        name: spec.name,
        metadata: spec.metadata,
        fromTemplate: spec.template,
        secrets: spec.secrets,
        envVars: spec.envVars,
        network: spec.network,
      })
    : await ops.connect(existing.id)

  try {
    if (bootstrapped) {
      for (const [path, contents] of Object.entries(spec.uploads ?? {})) {
        await box.files.write(path, contents)
      }
      // The expensive step — runs once, every warm tick skips it.
      await box.commands.run(spec.setup, { onStdout: log, onStderr: log })
    }

    const result = await box.commands.run(spec.iterate, {
      timeoutMs: ITERATE_TIMEOUT_MS,
      onStdout: log,
      onStderr: log,
    })

    return {
      sandboxId: box.id,
      bootstrapped,
      exitCode: result.exitCode,
      stdout: result.stdout,
    }
  } finally {
    if (spec.pauseWhenDone ?? true) {
      await box.pause()
    }
  }
}
