// Sandbox benchmark results from ComputeSDK, one head-to-head card per
// benchmark.
//
// Renders at once from the last good data (a browser cache, else the copy
// bundled below), then fetches fresh values from the Superserve website
// endpoint, which caches the ComputeSDK results for 12 hours. If the refresh
// fails, the cards keep the last good data. A benchmark without a result
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
    {
      key: "tti",
      title: "Time to interactive",
      description: "Sandbox start to first command",
      unit: "ms",
      better: "lower",
    },
    {
      key: "dax",
      title: "Clone, install, typecheck",
      description: "Total workload time",
      unit: "ms",
      better: "lower",
    },
    {
      key: "snapshot",
      title: "Snapshot and restore",
      unit: "score",
      better: "higher",
    },
    {
      key: "pause",
      title: "Pause and resume",
      unit: "score",
      better: "higher",
    },
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

  // Under 1 s in milliseconds (446ms), else seconds (1.07s). Scores: 95.4.
  const formatValue = (unit, value) => {
    if (unit === "score") return value.toFixed(1)
    if (value < 1000) return `${Math.round(value)}ms`
    return `${(value / 1000).toFixed(2)}s`
  }

  // Screen reader text, for example "1.07 seconds" or "95.4 out of 100".
  const spokenValue = (unit, value) => {
    if (unit === "score") return `${value.toFixed(1)} out of 100`
    if (value < 1000) return `${Math.round(value)} milliseconds`
    return `${(value / 1000).toFixed(2)} seconds`
  }

  // The badge shows only when Superserve is ahead. Times compare as a ratio
  // (other / Superserve); scores compare as a point gap. A ratio that rounds
  // to 1.00x or a gap that rounds to 0.0 shows no badge.
  const badgeFor = (chart, own, peer) => {
    if (chart.better === "lower") {
      if (!(own > 0 && own < peer)) return null
      const ratio = (peer / own).toFixed(2)
      return ratio === "1.00" ? null : `Superserve faster ${ratio}x`
    }
    if (!(own > peer)) return null
    const gap = (own - peer).toFixed(1)
    return gap === "0.0" ? null : `Superserve +${gap} points`
  }

  const hasValue = (key, provider) =>
    Number.isFinite(data.metrics[key]?.values?.[provider])

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
    <li className={own ? "ss-bench-row ss-bench-own" : "ss-bench-row"}>
      <span className="ss-bench-sr">
        {name}: {spokenValue(unit, value)}
      </span>
      <span className="ss-bench-name" aria-hidden="true">
        <i className="ss-bench-dot" />
        {name}
      </span>
      <span className="ss-bench-track" aria-hidden="true">
        <span
          className="ss-bench-bar"
          style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }}
        />
      </span>
      <span className="ss-bench-val" aria-hidden="true">
        {formatValue(unit, value)}
      </span>
    </li>
  )

  return (
    <>
      <div className="ss-bench not-prose">
        {charts.map((chart) => {
          const own = data.metrics[chart.key].values.superserve
          const peer = data.metrics[chart.key].values[compare]
          // Scores use a fixed 0-100 scale; times scale to the larger value.
          const max = chart.unit === "score" ? 100 : Math.max(own, peer)
          const badge = badgeFor(chart, own, peer)
          return (
            <figure className="ss-bench-card" key={chart.key}>
              <figcaption className="ss-bench-head">
                <span className="ss-bench-heading">
                  <strong className="ss-bench-title">{chart.title}</strong>
                  <span className="ss-bench-desc">
                    {chart.description && `${chart.description}. `}
                    <strong>
                      {chart.better === "lower" ? "Lower" : "Higher"} is better.
                    </strong>
                  </span>
                </span>
                {badge && <span className="ss-bench-badge">{badge}</span>}
              </figcaption>
              <ul className="ss-bench-rows">
                <Row
                  name={compareName}
                  unit={chart.unit}
                  value={peer}
                  max={max}
                />
                <Row
                  own
                  name="Superserve"
                  unit={chart.unit}
                  value={own}
                  max={max}
                />
              </ul>
            </figure>
          )
        })}
      </div>
      <p>
        Source: <a href={RATINGS_URL}>ComputeSDK benchmarks</a>, updated{" "}
        {updated}. Times are from the latest run. Scores are out of 100 and
        cover the last 7 days.
      </p>
    </>
  )
}
