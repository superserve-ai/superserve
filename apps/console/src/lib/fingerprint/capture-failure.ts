import { sanitizeDiagnostic } from "./diagnostics"

/**
 * The one capture failure that withholds the sign-up trial: the browser
 * reported that the device script did not load. The SDK reports this for a
 * blocked script and also for a failed script delivery; the browser cannot
 * tell them apart. Other browser capture failures (sdk_error,
 * incomplete_capture, provider HTTP errors, timeouts) do not count, so they
 * keep the trial.
 */
export type SignupCaptureFailure = "script_load_fail"

/**
 * Reads the browser diagnostics sent with a sign-up. The report is untrusted
 * client input, so it can only withhold the claimant's own trial; it never
 * grants credit or changes device evidence.
 */
export function signupCaptureFailure(
  report: unknown,
): SignupCaptureFailure | undefined {
  try {
    const value = report as { schema_version?: unknown; events?: unknown }
    if (value?.schema_version !== 1 || !Array.isArray(value.events))
      return undefined
    return value.events.slice(0, 8).some((candidate) => {
      const row = sanitizeDiagnostic(candidate)
      return row?.stage === "capture" && row.reason === "script_load_fail"
    })
      ? "script_load_fail"
      : undefined
  } catch {
    return undefined
  }
}
