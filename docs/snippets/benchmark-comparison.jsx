// Sandbox benchmark results from ComputeSDK, as a plain table.
//
// Renders at once from the last good data (a browser cache, else the copy
// bundled below), then fetches fresh values from the Superserve website
// endpoint, which caches the ComputeSDK results for 12 hours. If the refresh
// fails, the table keeps the last good data. A benchmark without a result
// for both providers is left out.
//
// Mintlify loads snippets as client components and supports named exports
// only, so every helper and the bundled data stay inside the component.
export const BenchmarkComparison = ({
  compare = "e2b",
  compareName = "E2B",
}) => {
  const ENDPOINT = "https://www.superserve.ai/api/benchmarks/"
  const STORAGE_KEY = "superserve-benchmarks-v1"
  const RATINGS_URL = "https://www.computesdk.com/benchmarks/sandboxes/ratings"

  // Last good data at the time of writing. Used only until the first
  // successful fetch in this browser. Keys match the endpoint response.
  const BUNDLED = {
    fetchedAt: "2026-11-14T00:04:36.863Z",
    metrics: {
      tti: { values: { superserve: 446, e2b: 1068 } },
      dax: { values: { superserve: 57422, e2b: 64219 } },
      snapshot: { values: { superserve: 95.4, e2b: 84.2 } },
      pause: { values: { superserve: 97, e2b: 90.9 } },
    },
  }

  // Times are in milliseconds; scores are out of 100.
  const ROWS = [
    { key: "tti", label: "Time to interactive", unit: "ms" },
    { key: "dax", label: "Clone, install, typecheck", unit: "ms" },
    { key: "snapshot", label: "Snapshot and restore", unit: "score" },
    { key: "pause", label: "Pause and resume", unit: "score" },
  ]

  const isUsable = (data) =>
    !!data &&
    typeof data.fetchedAt === "string" &&
    !!data.metrics &&
    ROWS.every(
      (row) => typeof data.metrics[row.key]?.values?.superserve === "number",
    )

  const readCache = () => {
    try {
      const cached = JSON.parse(window.localStorage.getItem(STORAGE_KEY))
      if (isUsable(cached) && cached.fetchedAt > BUNDLED.fetchedAt)
        return cached
    } catch {}
    return BUNDLED
  }

  const [data, setData] = useState(BUNDLED)

  useEffect(() => {
    setData(readCache())
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    fetch(ENDPOINT, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((fresh) => {
        if (!isUsable(fresh)) throw new Error("Unexpected data")
        setData((current) =>
          fresh.fetchedAt >= current.fetchedAt ? fresh : current,
        )
        if (fresh.status === "live") {
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh))
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer))
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // Run once on mount. The helpers are defined inside the snippet for Mintlify.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const format = (unit, value) => {
    if (unit === "score") return `${value.toFixed(1)} / 100`
    const s = value / 1000
    return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`
  }

  const hasValue = (key, provider) =>
    typeof data.metrics[key]?.values?.[provider] === "number"

  const rows = ROWS.filter(
    (row) => hasValue(row.key, "superserve") && hasValue(row.key, compare),
  )

  const updated = new Date(data.fetchedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Benchmark</th>
            <th>Superserve</th>
            <th>{compareName}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>
                {format(row.unit, data.metrics[row.key].values.superserve)}
              </td>
              <td>{format(row.unit, data.metrics[row.key].values[compare])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Source: <a href={RATINGS_URL}>ComputeSDK benchmarks</a>, updated{" "}
        {updated}.
      </p>
    </>
  )
}
