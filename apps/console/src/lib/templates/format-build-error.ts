const TITLES: Record<string, string> = {
  image_pull_failed: "Failed to pull base image",
  step_failed: "A build step failed",
  boot_failed: "Build VM failed to boot",
  snapshot_failed: "Snapshot creation failed",
  start_cmd_failed: "Start command failed",
  ready_cmd_failed: "Readiness check failed",
  build_failed: "Build failed",
}

export interface FormattedBuildError {
  title: string
  detail: string
}

/**
 * Backend error messages are prefixed with a stable code like
 * `step_failed: step 1/2 failed after 3s: exited with code 100`. This maps
 * the code to a human title and peels off the detail portion.
 */
export function formatBuildError(
  raw: string | null | undefined,
): FormattedBuildError {
  if (!raw) return { title: "Build failed", detail: "" }
  const match = raw.match(/^([a-z_]+):\s*([\s\S]*)$/)
  if (!match) return { title: "Build failed", detail: raw }
  const [, code, rest] = match
  return {
    title: TITLES[code] ?? "Build failed",
    detail: rest.trim(),
  }
}
