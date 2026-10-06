/**
 * Formats a log line's timestamp as HH:mm:ss in local time. Accepts ISO
 * timestamps, falls back to the time portion of an unparseable one, and
 * tolerates an event that arrives without a timestamp at all: the gutter
 * label is worth less than the log body it sits next to.
 */
export function formatLogTime(ts: string | undefined): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(11, 19)
  return d.toLocaleTimeString([], { hour12: false })
}
