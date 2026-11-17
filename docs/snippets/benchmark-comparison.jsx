// Sandbox benchmark results from ComputeSDK, one head-to-head card per
// benchmark.
//
// The numbers are pinned below with the date they were read, and the page
// makes no network request. To refresh them, copy the values from the
// ComputeSDK ratings and update AS_OF. A benchmark without a result for both
// providers is left out. Styles are in docs/style.css (.ss-bench).
//
// Mintlify loads snippets as client components and supports named exports
// only, so every helper and the data stay inside the component.
//
// Props: `compare` is the provider key in DATA, `compareName` its display
// name, and `sourceUrl` the ComputeSDK comparison page for that provider.
// Without `sourceUrl`, the source link goes to the ratings page.
export const BenchmarkComparison = ({
  compare = "e2b",
  compareName = "E2B",
  sourceUrl,
}) => {
  const RATINGS_URL = "https://www.computesdk.com/benchmarks/sandboxes/ratings"

  // ComputeSDK results read on AS_OF.
  const AS_OF = "Nov 16, 2026"
  const DATA = {
    tti: { superserve: 446, e2b: 1068, daytona: 627 },
    dax: { superserve: 57422, e2b: 64219, modal: 48147 },
    snapshot: { superserve: 95.4, e2b: 84.8, modal: 88.3, daytona: 71.1 },
    pause: { superserve: 97.1, e2b: 91, modal: 0, daytona: 0 },
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

  const hasValue = (key, provider) => Number.isFinite(DATA[key]?.[provider])

  const charts = CHARTS.filter(
    (chart) =>
      hasValue(chart.key, "superserve") && hasValue(chart.key, compare),
  )

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
    <div className="ss-bench not-prose">
      {charts.map((chart) => {
        const own = DATA[chart.key].superserve
        const peer = DATA[chart.key][compare]
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
      <p className="ss-bench-source">
        Source: <a href={sourceUrl || RATINGS_URL}>ComputeSDK ratings</a>,{" "}
        {AS_OF}.
        {charts.some((chart) => chart.unit === "score") &&
          " Scores are out of 100."}
      </p>
    </div>
  )
}
