import { useCallback, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ClipboardCopy,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  Info,
  Shield,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import exporterScript from '../tools/steam-conduct-exporter.js?raw'
import './App.css'
import {
  type ConductSummary,
  type ParsedConductHistory,
  opendotaMatchUrl,
  parseConductSummariesFromHtml,
  sortChronologically,
  toCsv,
} from './parser'

const STORAGE_KEY = 'dota2-behaviour-score-history:v1'
const STEAM_SOURCE_URL = 'https://steamcommunity.com/my/gcpd/570?category=Account&tab=MatchPlayerReportIncoming'

function GitHubLogo({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.49 0 12.26c0 5.42 3.44 10.01 8.2 11.63.6.11.82-.27.82-.59 0-.29-.01-1.06-.02-2.08-3.34.74-4.04-1.64-4.04-1.64-.55-1.41-1.34-1.79-1.34-1.79-1.09-.76.08-.74.08-.74 1.2.09 1.84 1.26 1.84 1.26 1.07 1.87 2.81 1.33 3.5 1.02.11-.79.42-1.33.76-1.64-2.67-.31-5.47-1.36-5.47-6.08 0-1.34.47-2.44 1.24-3.3-.12-.31-.54-1.57.12-3.26 0 0 1.01-.33 3.3 1.26A11.3 11.3 0 0 1 12 5.8c1.02.01 2.04.14 3 .41 2.29-1.59 3.3-1.26 3.3-1.26.66 1.69.24 2.95.12 3.26.77.86 1.24 1.96 1.24 3.3 0 4.73-2.81 5.76-5.49 6.07.43.38.81 1.12.81 2.26 0 1.63-.01 2.95-.01 3.35 0 .33.21.71.82.59A12.21 12.21 0 0 0 24 12.26C24 5.49 18.63 0 12 0Z" />
    </svg>
  )
}

type ChartDatum = ConductSummary & {
  dateLabel: string
  delta: number
  scoreAfterWindow: number
  reportTotal: number
  positiveRate: number
  reportRate: number
}

function loadStoredHistory(): ParsedConductHistory | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ParsedConductHistory) : null
  } catch {
    return null
  }
}

function persistHistory(history: ParsedConductHistory | null) {
  if (!history) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
}

function formatDate(timestamp: number | null, fallback: string) {
  if (!timestamp) return fallback
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(timestamp)
}

function formatDateTime(timestamp: number | null, fallback: string) {
  if (!timestamp) return fallback
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(timestamp)
}

function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

type RollupDatum = {
  dateLabel: string
  commends: number
  reportTotal: number
  positiveMatches: number
  reportedMatches: number
  abandonedMatches: number
  summaries: number
}

function monthKey(timestamp: number | null, fallback: string) {
  if (!timestamp) return fallback
  const date = new Date(timestamp)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  if (!/^\d{4}-\d{2}$/.test(key)) return key
  const [year, month] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
    Date.UTC(year, month - 1, 1),
  )
}

function quarterKey(timestamp: number | null, fallback: string) {
  if (!timestamp) return fallback
  const date = new Date(timestamp)
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1
  return `${date.getUTCFullYear()}-Q${quarter}`
}

function quarterLabel(key: string) {
  const match = key.match(/^(\d{4})-Q([1-4])$/)
  if (!match) return key
  return `Q${match[2]} ${match[1].slice(2)}`
}

function rollupRows(rows: ChartDatum[], granularity: 'month' | 'quarter'): RollupDatum[] {
  const groups = new Map<string, RollupDatum>()

  for (const row of rows) {
    const key = granularity === 'quarter' ? quarterKey(row.timestamp, row.dateLabel) : monthKey(row.timestamp, row.dateLabel)
    const current = groups.get(key) ?? {
      dateLabel: granularity === 'quarter' ? quarterLabel(key) : monthLabel(key),
      commends: 0,
      reportTotal: 0,
      positiveMatches: 0,
      reportedMatches: 0,
      abandonedMatches: 0,
      summaries: 0,
    }

    current.commends += row.commends
    current.reportTotal += row.reportTotal
    current.positiveMatches += row.positiveMatches
    current.reportedMatches += row.reportedMatches
    current.abandonedMatches += row.abandonedMatches
    current.summaries += 1
    groups.set(key, current)
  }

  return Array.from(groups.values())
}


function StatCard({
  icon,
  label,
  value,
  subline,
  tone = 'neutral',
}: {
  icon: React.ReactNode
  label: string
  value: string
  subline: string
  tone?: 'neutral' | 'good' | 'warn'
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{subline}</span>
      </div>
    </article>
  )
}

function App() {
  const [history, setHistory] = useState<ParsedConductHistory | null>(() => loadStoredHistory())
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedExporter, setCopiedExporter] = useState(false)
  const [guideOpen, setGuideOpen] = useState(true)

  const setParsedHistory = useCallback((nextHistory: ParsedConductHistory | null) => {
    setHistory(nextHistory)
    persistHistory(nextHistory)
  }, [])

  const parseHtml = useCallback(
    (html: string) => {
      try {
        const parsed = parseConductSummariesFromHtml(html)
        setParsedHistory(parsed)
        setError(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unknown parser error')
      }
    },
    [setParsedHistory],
  )

  const parseJson = useCallback(
    (rawJson: string) => {
      try {
        const parsed = JSON.parse(rawJson) as Partial<ParsedConductHistory>
        if (!Array.isArray(parsed.summaries) || parsed.summaries.length === 0) {
          throw new Error('The JSON file does not contain a non-empty summaries array.')
        }

        setParsedHistory({
          summaries: parsed.summaries as ConductSummary[],
          source: parsed.source ?? 'json-import',
          parsedAt: parsed.parsedAt ?? new Date().toISOString(),
        })
        setError(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unknown JSON import error')
      }
    },
    [setParsedHistory],
  )

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      const content = await file.text()

      if (/\.json$/i.test(file.name)) {
        parseJson(content)
        return
      }

      if (/\.html?$/i.test(file.name)) {
        parseHtml(content)
        return
      }

      if (content.trim().startsWith('{')) {
        parseJson(content)
        return
      }

      setError('Please select a saved Steam .html file or exporter .json file.')
    },
    [parseHtml, parseJson],
  )

  const chartData = useMemo<ChartDatum[]>(() => {
    if (!history) return []
    return sortChronologically(history.summaries).map((summary, index, rows) => {
      const previous = rows[index - 1]
      const reportTotal = summary.reports + summary.commsReports
      return {
        ...summary,
        dateLabel: formatDate(summary.timestamp, summary.matchId),
        delta: previous ? summary.behaviorScore - previous.behaviorScore : 0,
        scoreAfterWindow: summary.behaviorScore,
        reportTotal,
        positiveRate: summary.matchCount ? Math.round((summary.positiveMatches / summary.matchCount) * 100) : 0,
        reportRate: summary.matchCount ? Math.round((summary.reportedMatches / summary.matchCount) * 100) : 0,
      }
    })
  }, [history])

  const rollupGranularity = chartData.length > 180 ? 'quarter' : 'month'
  const denseHistory = chartData.length > 90
  const rollupData = useMemo(() => rollupRows(chartData, rollupGranularity), [chartData, rollupGranularity])
  const secondaryChartData = (denseHistory ? rollupData : chartData) as ChartDatum[]
  const secondaryChartLabel = denseHistory
    ? `${rollupGranularity === 'quarter' ? 'quarterly' : 'monthly'} rollup for dense histories`
    : 'per conduct window'
  const xTickInterval = chartData.length > 180 ? Math.ceil(chartData.length / 14) : 'preserveStartEnd'

  const copyExporterScript = useCallback(async () => {
    await navigator.clipboard.writeText(exporterScript)
    setCopiedExporter(true)
    window.setTimeout(() => setCopiedExporter(false), 1800)
  }, [])

  const tableRows = useMemo(() => [...chartData].reverse(), [chartData])

  const stats = useMemo(() => {
    if (!chartData.length) return null
    const first = chartData[0]
    const latest = chartData[chartData.length - 1]
    const previous = chartData[chartData.length - 2]
    const best = chartData.reduce((max, row) => (row.behaviorScore > max.behaviorScore ? row : max), first)
    const worst = chartData.reduce((min, row) => (row.behaviorScore < min.behaviorScore ? row : min), first)
    const totalReports = chartData.reduce((sum, row) => sum + row.reports + row.commsReports, 0)
    const totalCommends = chartData.reduce((sum, row) => sum + row.commends, 0)
    const totalMatches = chartData.reduce((sum, row) => sum + row.matchCount, 0)
    const reportWindows = chartData.filter((row) => row.reports + row.commsReports + row.reportedMatches > 0).length

    return {
      latest,
      previous,
      first,
      best,
      worst,
      totalReports,
      totalCommends,
      totalMatches,
      reportWindows,
      scoreDelta: latest.behaviorScore - first.behaviorScore,
      latestDelta: previous ? latest.behaviorScore - previous.behaviorScore : 0,
    }
  }, [chartData])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      setIsDragging(false)
      void handleFile(event.dataTransfer.files[0])
    },
    [handleFile],
  )

  return (
    <main className="app-shell">
      <section className="hero-section">
        <nav className="topbar" aria-label="Project links">
          <a href={STEAM_SOURCE_URL} target="_blank" rel="noreferrer">
            Steam data <ExternalLink size={16} />
          </a>
          <a href="https://github.com/platzebo/Dota2-Behaviour-Score-History" target="_blank" rel="noreferrer">
            <GitHubLogo size={16} /> platzebo <ExternalLink size={16} />
          </a>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow"><Shield size={16} /> Dota 2 Conduct Summary Visualizer</p>
            <h1>Visualize your Dota 2 behaviour score history.</h1>
            <p className="lead">
              Import the JSON from the embedded Steam console exporter or a saved Steam HTML page. Everything is parsed locally in your browser, with OpenDota links for every Conduct Summary MatchID.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#import">
                <UploadCloud size={18} /> Import data
              </a>
            </div>
          </div>
          <div className="hero-panel" aria-label="Quick guide">
            <h2>Recommended import</h2>
            <p>
              Steam's regular “Save Page As…” often keeps only the first 20 rows. Use the embedded exporter
              instead: copy it, paste it into the Steam page console, then import the downloaded JSON here. Open
              the how-to guide below if you want the exact steps.
            </p>
            <button className="button primary full" type="button" onClick={() => void copyExporterScript()}>
              <ClipboardCopy size={18} /> {copiedExporter ? 'Copied exporter script' : 'Copy exporter script'}
            </button>
            <button
              className="button ghost full"
              type="button"
              onClick={() => {
                setGuideOpen(true)
                window.setTimeout(() => document.getElementById('export-guide')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
              }}
            >
              <Info size={18} /> Show how-to guide
            </button>
          </div>
        </div>
      </section>

      <details
        id="export-guide"
        className="exporter-guide"
        open={guideOpen}
        onToggle={(event) => setGuideOpen(event.currentTarget.open)}
      >
        <summary>How to export the full Steam history with the console script</summary>
        <div className="guide-grid">
          <div>
            <ol>
              <li>
                Open the{' '}
                <a href={STEAM_SOURCE_URL} target="_blank" rel="noreferrer">
                  Steam data page
                </a>{' '}
                while logged in.
              </li>
              <li>Open DevTools → Console on that Steam page.</li>
              <li>Click <strong>Copy exporter script</strong> above and paste it into the console.</li>
              <li>Press Enter and wait until <code>dota2-conduct-history.json</code> downloads.</li>
              <li>Drop that JSON file into this app.</li>
            </ol>
            <p>
              The exporter calls Steam's own Load More History endpoint from your logged-in page. It stays local
              and only creates a downloadable JSON file. If Steam returns HTTP 429, wait a few minutes and retry.
            </p>
          </div>
          <div className="embedded-code" aria-label="Embedded Steam console exporter script">
            <div className="code-toolbar">
              <span>steam-conduct-exporter.js</span>
              <button className="button ghost code-copy" type="button" onClick={() => void copyExporterScript()}>
                <ClipboardCopy size={16} /> {copiedExporter ? 'Copied' : 'Copy code'}
              </button>
            </div>
            <pre><code>{exporterScript}</code></pre>
          </div>
        </div>
      </details>

      <section id="import" className="import-section">
        <label
          className={`dropzone ${isDragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <input type="file" accept=".html,.htm,.json,text/html,application/json" onChange={(event) => void handleFile(event.target.files?.[0])} />
          <FileCode2 size={38} />
          <strong>Drop or select Steam HTML/JSON here</strong>
          <span>Expects Steam HTML or the JSON file from the Steam console exporter.</span>
        </label>
        {error ? (
          <div className="notice error" role="alert">
            <AlertTriangle size={18} /> {error}
          </div>
        ) : null}
        {history ? (
          <div className="notice success">
            <CheckCircle2 size={18} /> {history.summaries.length} Conduct Summary entries loaded. Last imported:{' '}
            {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(history.parsedAt))}
          </div>
        ) : null}
      </section>


      {stats ? (
        <>
          <section className="stats-grid" aria-label="Key metrics">
            <StatCard
              icon={<Activity size={22} />}
              label="Current score"
              value={stats.latest.behaviorScore.toLocaleString('en-US')}
              subline={`${stats.latestDelta >= 0 ? '+' : ''}${stats.latestDelta} since the previous summary`}
              tone={stats.latestDelta >= 0 ? 'good' : 'warn'}
            />
            <StatCard
              icon={<BarChart3 size={22} />}
              label="Overall trend"
              value={`${stats.scoreDelta >= 0 ? '+' : ''}${stats.scoreDelta}`}
              subline={`${formatDate(stats.first.timestamp, stats.first.matchId)} → ${formatDate(stats.latest.timestamp, stats.latest.matchId)}`}
              tone={stats.scoreDelta >= 0 ? 'good' : 'warn'}
            />
            <StatCard
              icon={<Shield size={22} />}
              label="Best / Worst"
              value={`${stats.best.behaviorScore} / ${stats.worst.behaviorScore}`}
              subline={`${chartData.length} Summaries · ${stats.totalMatches} Matches`}
            />
            <StatCard
              icon={<Info size={22} />}
              label="Reports / Commends"
              value={`${stats.totalReports} / ${stats.totalCommends}`}
              subline={`${stats.reportWindows} windows with report activity`}
            />
          </section>

          <section className="charts-grid">
            <article className="chart-card wide">
              <div className="section-heading">
                <h2>Behaviour Score Timeline</h2>
                <span>0–12,000 behaviour score scale</span>
              </div>
              <ResponsiveContainer width="100%" height={420}>
                <AreaChart data={chartData} margin={{ top: 15, right: 20, bottom: 10, left: 0 }}>
                  <defs>
                    <linearGradient id="scoreGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#58f29b" stopOpacity={0.55} />
                      <stop offset="95%" stopColor="#58f29b" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                  <XAxis dataKey="dateLabel" interval={xTickInterval} minTickGap={22} tick={{ fill: '#9fb0c7', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#9fb0c7', fontSize: 12 }} width={56} domain={[0, 12000]} />
                  <Tooltip contentStyle={{ background: '#101824', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14 }} />
                  <Area type="monotone" dataKey="behaviorScore" name="Behavior Score" stroke="#58f29b" strokeWidth={3} fill="url(#scoreGradient)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </article>

            <article className="chart-card">
              <div className="section-heading">
                <h2>Reports vs. Commends</h2>
                <span>{secondaryChartLabel}</span>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={secondaryChartData} margin={{ top: 15, right: 10, bottom: 10, left: -20 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                  <XAxis dataKey="dateLabel" interval="preserveStartEnd" minTickGap={18} tick={{ fill: '#9fb0c7', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9fb0c7', fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: '#101824', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14 }} />
                  <Legend />
                  <Bar dataKey="commends" name="Commends" fill="#58f29b" radius={[8, 8, 0, 0]} />
                  <Line type="monotone" dataKey="reportTotal" name="Reports + Comms Reports" stroke="#ff667a" strokeWidth={3} dot={!denseHistory} />
                </ComposedChart>
              </ResponsiveContainer>
            </article>

            <article className="chart-card">
              <div className="section-heading">
                <h2>Match quality</h2>
                <span>{denseHistory ? `${rollupGranularity === 'quarter' ? 'quarterly' : 'monthly'} totals` : 'positive / reported / abandoned matches'}</span>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={secondaryChartData} margin={{ top: 15, right: 10, bottom: 10, left: -20 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                  <XAxis dataKey="dateLabel" interval="preserveStartEnd" minTickGap={18} tick={{ fill: '#9fb0c7', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9fb0c7', fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: '#101824', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14 }} />
                  <Legend />
                  <Bar dataKey="positiveMatches" stackId="matches" name="Positive" fill="#58f29b" />
                  <Bar dataKey="reportedMatches" stackId="matches" name="Reported" fill="#ffb454" />
                  <Bar dataKey="abandonedMatches" stackId="matches" name="Abandoned" fill="#ff667a" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </article>
          </section>

          <section className="table-section">
            <div className="section-heading table-heading">
              <div>
                <h2>Conduct Summary Details</h2>
                <span>MatchIDs open directly in OpenDota</span>
              </div>
              <div className="table-actions">
                <button className="button compact" type="button" onClick={() => downloadText('dota2-conduct-history.csv', toCsv(tableRows), 'text/csv')}>
                  <Download size={16} /> CSV
                </button>
                <button
                  className="button compact"
                  type="button"
                  onClick={() => downloadText('dota2-conduct-history.json', JSON.stringify(history, null, 2), 'application/json')}
                >
                  <Download size={16} /> JSON
                </button>
                <button className="button compact danger" type="button" onClick={() => setParsedHistory(null)}>
                  <Trash2 size={16} /> Clear
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MatchID</th>
                    <th>Date</th>
                    <th>Score</th>
                    <th>Δ</th>
                    <th>Matches</th>
                    <th>Positive</th>
                    <th>Reported</th>
                    <th>Reports</th>
                    <th>Comms Reports</th>
                    <th>Commends</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => (
                    <tr key={row.matchId}>
                      <td>
                        <a href={opendotaMatchUrl(row.matchId)} target="_blank" rel="noreferrer" className="match-link">
                          {row.matchId} <ExternalLink size={13} />
                        </a>
                      </td>
                      <td>{formatDateTime(row.timestamp, row.dateText)}</td>
                      <td className="score-cell">{row.behaviorScore}</td>
                      <td className={row.delta >= 0 ? 'delta-up' : 'delta-down'}>{row.delta >= 0 ? '+' : ''}{row.delta}</td>
                      <td>{row.matchCount}</td>
                      <td>{row.positiveMatches}</td>
                      <td>{row.reportedMatches}</td>
                      <td>{row.reports}</td>
                      <td>{row.commsReports}</td>
                      <td>{row.commends}</td>
                      <td>
                        {row.excessiveReports || row.excessiveAbandons ? (
                          <span className="flag bad">Warning</span>
                        ) : (
                          <span className="flag good">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="empty-state">
          <BarChart3 size={52} />
          <h2>No history loaded yet</h2>
          <p>Import exporter JSON or saved Steam HTML to see the charts.</p>
        </section>
      )}
    </main>
  )
}

export default App
