// Live sandbox benchmark comparison from ComputeSDK.
//
// Renders at once from the last good data (a browser cache, else the copy
// bundled below), then fetches fresh values from the Superserve website
// endpoint, which caches the ComputeSDK results for 12 hours. Bars never
// render empty: if the refresh fails, the cards keep the last good data and
// say so. A benchmark without a result for both providers is left out.
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
  // successful fetch in this browser.
  const BUNDLED = {
    fetchedAt: "2026-11-14T00:04:36.863Z",
    metrics: {
      tti: {
        unit: "ms",
        basis: "latest-run",
        direction: "lower",
        updatedAt: "2026-11-13T19:29:52.469Z",
        sourceUrl: "https://www.computesdk.com/benchmarks/sandboxes/burst-tti",
        values: { superserve: 446, e2b: 1068 },
      },
      dax: {
        unit: "ms",
        basis: "latest-run",
        direction: "lower",
        updatedAt: "2026-11-13T13:40:19.048Z",
        sourceUrl: "https://www.computesdk.com/benchmarks/sandboxes/dax",
        values: { superserve: 57422, e2b: 64219 },
      },
      snapshot: {
        unit: "score",
        basis: "7-day-score",
        direction: "higher",
        updatedAt: "2026-11-13",
        sourceUrl:
          "https://www.computesdk.com/benchmarks/sandboxes/filesystem-snapshot",
        values: { superserve: 95.4, e2b: 84.2 },
      },
      pause: {
        unit: "score",
        basis: "7-day-score",
        direction: "higher",
        updatedAt: "2026-11-13",
        sourceUrl:
          "https://www.computesdk.com/benchmarks/sandboxes/pause-resume",
        values: { superserve: 97, e2b: 90.9 },
      },
    },
  }

  const CARDS = [
    {
      key: "tti",
      title: "Time to interactive",
      description:
        "Median time from create() to first command, 100 sandboxes at once.",
    },
    {
      key: "dax",
      title: "DAX workload",
      description:
        "Clone, install, and typecheck the OpenCode repo in a fresh sandbox.",
    },
    {
      key: "snapshot",
      title: "Snap and restore",
      description:
        "Create a filesystem snapshot, restore it, and verify the files.",
    },
    {
      key: "pause",
      title: "Pause and resume",
      description: "Pause a sandbox and resume it with its state intact.",
    },
  ]

  const isUsable = (data) =>
    !!data &&
    typeof data.fetchedAt === "string" &&
    !!data.metrics &&
    CARDS.every(
      (card) =>
        data.metrics[card.key] &&
        typeof data.metrics[card.key].values?.superserve === "number",
    )

  const readCache = () => {
    try {
      const cached = JSON.parse(window.localStorage.getItem(STORAGE_KEY))
      if (isUsable(cached) && cached.fetchedAt > BUNDLED.fetchedAt)
        return cached
    } catch {}
    return BUNDLED
  }

  // "ok": showing fresh data (or waiting for it); "fallback": showing last
  // good data because the refresh failed.
  const [data, setData] = useState(BUNDLED)
  const [status, setStatus] = useState("ok")

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
          setStatus("ok")
        } else {
          setStatus("fallback")
        }
      })
      .catch(() => setStatus("fallback"))
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
  const formatValue = (metric, value) => {
    if (metric.unit === "score") return value.toFixed(1)
    const s = seconds(value)
    return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`
  }
  const formatTick = (metric, value) =>
    metric.unit === "score" ? String(value) : `${Number(value.toFixed(2))} s`

  const formatDate = (metric) => {
    if (metric.basis === "7-day-score") return metric.updatedAt.slice(0, 10)
    const date = new Date(metric.updatedAt)
    if (Number.isNaN(date.getTime())) return metric.updatedAt
    return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
  }

  const stamp = (metric) => {
    const date = formatDate(metric)
    if (status === "fallback") {
      return metric.basis === "7-day-score"
        ? `Refresh failed · Last good: 7-day score, ${date}`
        : `Refresh failed · Last good: ${date}`
    }
    return metric.basis === "7-day-score"
      ? `7-day score · Updated ${date}`
      : `Latest run · Updated ${date}`
  }

  const hasValue = (metric, provider) =>
    typeof metric?.values?.[provider] === "number"

  // Only benchmarks with a result for both providers get a card.
  const cards = CARDS.filter(
    (card) =>
      hasValue(data.metrics[card.key], "superserve") &&
      hasValue(data.metrics[card.key], compare),
  )

  const Row = ({ own, name, metric, value, max }) => (
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
      <div className="ss-bench-val">{formatValue(metric, value)}</div>
    </div>
  )

  return (
    <div className="ss-bench not-prose">
      <div className="ss-bench-live">
        <i className="ss-bench-pulse" />
        {status === "fallback" ? (
          <span>
            Showing last good data - <a href={RATINGS_URL}>ComputeSDK</a>
          </span>
        ) : (
          <span>
            Live data from <a href={RATINGS_URL}>ComputeSDK</a> - refreshed
            every 12 h
          </span>
        )}
      </div>
      <div className="ss-bench-cards">
        {cards.map((card) => {
          const metric = data.metrics[card.key]
          const own = metric.values.superserve
          const peer = metric.values[compare]
          const max =
            metric.unit === "score"
              ? 100
              : niceCeil(seconds(Math.max(own, peer)) * 1.1) * 1000
          return (
            <div className="ss-bench-card" key={card.key}>
              <div className="ss-bench-title">
                <span className="ss-bench-chev">&gt;</span>
                {card.title}
              </div>
              <div className="ss-bench-sub">
                {card.description}{" "}
                <strong>
                  {metric.direction === "lower"
                    ? "Lower is better."
                    : "Higher is better."}
                </strong>
              </div>
              <Row
                own
                name="Superserve"
                metric={metric}
                value={own}
                max={max}
              />
              <Row name={compareName} metric={metric} value={peer} max={max} />
              <div className="ss-bench-axis">
                <span />
                <div className="ss-bench-ticks">
                  <span>{formatTick(metric, 0)}</span>
                  <span>
                    {formatTick(
                      metric,
                      metric.unit === "score" ? max / 2 : seconds(max / 2),
                    )}
                  </span>
                  <span>
                    {formatTick(
                      metric,
                      metric.unit === "score" ? max : seconds(max),
                    )}
                  </span>
                </div>
                <span />
              </div>
              <div className="ss-bench-foot">
                <span>{stamp(metric)}</span>
                <a href={metric.sourceUrl}>ComputeSDK ↗</a>
              </div>
            </div>
          )
        })}
      </div>
      <div className="ss-bench-legend">
        <span>
          <i className="ss-bench-dot ss-bench-dot-own" />
          Superserve
        </span>
        <span>
          <i className="ss-bench-dot" />
          {compareName}
        </span>
        <span>Bars use the same scale inside each card only.</span>
      </div>
    </div>
  )
}
