// Sandbox benchmark results from ComputeSDK, as one bar chart per benchmark.
//
// Renders at once from the last good data (a browser cache, else the copy
// bundled below), then fetches fresh values from the Superserve website
// endpoint, which caches the ComputeSDK results for 12 hours. If the refresh
// fails, the charts keep the last good data. A benchmark without a result
// for both providers is left out. Styles are in docs/style.css (.ss-bench).
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
  const CHARTS = [
    { key: "tti", title: "Time to interactive", unit: "ms" },
    { key: "dax", title: "Clone, install, typecheck", unit: "ms" },
    { key: "snapshot", title: "Snapshot and restore", unit: "score" },
    { key: "pause", title: "Pause and resume", unit: "score" },
  ]

  const isUsable = (data) =>
    !!data &&
    typeof data.fetchedAt === "string" &&
    !!data.metrics &&
    CHARTS.every(
      (chart) =>
        typeof data.metrics[chart.key]?.values?.superserve === "number",
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

  // Rounds up to 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 times a power of ten.
  const niceCeil = (value) => {
    const power = 10 ** Math.floor(Math.log10(value))
    const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(
      (s) => s * power >= value,
    )
    return step * power
  }

  const seconds = (ms) => ms / 1000
  const formatValue = (unit, value) => {
    if (unit === "score") return value.toFixed(1)
    const s = seconds(value)
    return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`
  }
  const formatTick = (unit, value) =>
    unit === "score" ? String(value) : `${Number(seconds(value).toFixed(2))} s`

  const hasValue = (key, provider) =>
    typeof data.metrics[key]?.values?.[provider] === "number"

  const charts = CHARTS.filter(
    (chart) =>
      hasValue(chart.key, "superserve") && hasValue(chart.key, compare),
  )

  const updated = new Date(data.fetchedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

  const Row = ({ own, name, unit, value, max }) => (
    <div className={own ? "ss-bench-row ss-bench-own" : "ss-bench-row"}>
      <div className="ss-bench-name">
        <i className={own ? "ss-bench-dot ss-bench-dot-own" : "ss-bench-dot"} />
        {name}
      </div>
      <div className="ss-bench-track">
        <div
          className={own ? "ss-bench-bar ss-bench-bar-own" : "ss-bench-bar"}
          style={{ width: `${Math.max((value / max) * 100, 0.5)}%` }}
        />
      </div>
      <div className="ss-bench-val">{formatValue(unit, value)}</div>
    </div>
  )

  return (
    <>
      <div className="ss-bench not-prose">
        <div className="ss-bench-cards">
          {charts.map((chart) => {
            const own = data.metrics[chart.key].values.superserve
            const peer = data.metrics[chart.key].values[compare]
            const max =
              chart.unit === "score"
                ? 100
                : niceCeil(seconds(Math.max(own, peer)) * 1.1) * 1000
            return (
              <div className="ss-bench-card" key={chart.key}>
                <div className="ss-bench-title">
                  <span className="ss-bench-chev">&gt;</span>
                  {chart.title}
                </div>
                <Row
                  own
                  name="Superserve"
                  unit={chart.unit}
                  value={own}
                  max={max}
                />
                <Row
                  name={compareName}
                  unit={chart.unit}
                  value={peer}
                  max={max}
                />
                <div className="ss-bench-axis">
                  <span />
                  <div className="ss-bench-ticks">
                    <span>{formatTick(chart.unit, 0)}</span>
                    <span>{formatTick(chart.unit, max / 2)}</span>
                    <span>{formatTick(chart.unit, max)}</span>
                  </div>
                  <span />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <p>
        Source: <a href={RATINGS_URL}>ComputeSDK benchmarks</a>, updated{" "}
        {updated}.
      </p>
    </>
  )
}
