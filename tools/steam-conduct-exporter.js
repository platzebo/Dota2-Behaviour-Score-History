/*
 * Dota 2 Behaviour Score History exporter
 *
 * Usage:
 * 1. Open https://steamcommunity.com/my/gcpd/570?category=Account&tab=MatchPlayerReportIncoming
 * 2. Open browser DevTools Console on that Steam page.
 * 3. Paste this whole script and press Enter.
 * 4. Import the downloaded dota2-conduct-history.json into the visualizer.
 *
 * The script runs in your logged-in Steam page, uses Steam's own Load More History
 * AJAX endpoint, and downloads a local JSON file. It does not send data anywhere else.
 */
(async () => {
  const TAB = 'MatchPlayerReportIncoming'
  const DELAY_MS = 750
  const MAX_PAGES = 250

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const normalize = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase()
  const text = (element) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const number = (value) => {
    const parsed = Number.parseInt(String(value).replace(/[^0-9.-]/g, ''), 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const bool = (value) => /^(yes|true|1|ja)$/i.test(String(value).trim())
  const parseSteamDate = (value) => {
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT$/i)
    if (!match) {
      const fallback = Date.parse(value)
      return Number.isFinite(fallback) ? fallback : null
    }
    const [, year, month, day, hour, minute, second] = match
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  }

  const headerMap = {
    'conduct summary matchid': 'matchId',
    'conduct summary match id': 'matchId',
    'conduct summary date': 'dateText',
    periodic: 'periodic',
    'excessive reports': 'excessiveReports',
    'excessive abandons': 'excessiveAbandons',
    'match count': 'matchCount',
    'positive matches': 'positiveMatches',
    'reported matches': 'reportedMatches',
    'abandoned matches': 'abandonedMatches',
    reports: 'reports',
    'reporting parties': 'reportingParties',
    'comms reports': 'commsReports',
    'comms reporting parties': 'commsReportingParties',
    commends: 'commends',
    'behavior score': 'behaviorScore',
  }

  const numericFields = new Set([
    'matchCount',
    'positiveMatches',
    'reportedMatches',
    'abandonedMatches',
    'reports',
    'reportingParties',
    'commsReports',
    'commsReportingParties',
    'commends',
    'behaviorScore',
  ])
  const booleanFields = new Set(['periodic', 'excessiveReports', 'excessiveAbandons'])

  const findTable = (doc) =>
    Array.from(doc.querySelectorAll('table')).find((table) => {
      const headers = Array.from(table.querySelectorAll('th')).map(text)
      return headers.includes('Conduct Summary MatchID') && headers.includes('Behavior Score')
    })

  const emptySummary = () => ({
    matchId: '',
    dateText: '',
    timestamp: null,
    periodic: false,
    excessiveReports: false,
    excessiveAbandons: false,
    matchCount: 0,
    positiveMatches: 0,
    reportedMatches: 0,
    abandonedMatches: 0,
    reports: 0,
    reportingParties: 0,
    commsReports: 0,
    commsReportingParties: 0,
    commends: 0,
    behaviorScore: 0,
  })

  const parseTable = (table) => {
    if (!table) return []
    const fields = Array.from(table.querySelectorAll('tr:first-child th')).map((header) => headerMap[normalize(text(header))] ?? null)
    return Array.from(table.querySelectorAll('tr'))
      .slice(1)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td'))
        if (!cells.length) return null
        const summary = emptySummary()
        fields.forEach((field, index) => {
          if (!field) return
          const value = text(cells[index])
          if (field === 'dateText') {
            summary.dateText = value
            summary.timestamp = parseSteamDate(value)
          } else if (field === 'matchId') {
            summary.matchId = value.replace(/[^0-9]/g, '')
          } else if (numericFields.has(field)) {
            summary[field] = number(value)
          } else if (booleanFields.has(field)) {
            summary[field] = bool(value)
          }
        })
        return summary.matchId && summary.behaviorScore ? summary : null
      })
      .filter(Boolean)
  }

  const currentTable = findTable(document)
  if (!currentTable) {
    throw new Error('No Conduct Summary table found. Make sure you are on the Incoming Match Player Report Steam page.')
  }
  if (!window.g_sessionID) {
    throw new Error('Steam session ID not found. Make sure you are logged in, then reload the Steam page.')
  }

  const byMatchId = new Map()
  const addRows = (rows) => rows.forEach((row) => byMatchId.set(row.matchId, row))
  addRows(parseTable(currentTable))

  let continueToken = window.g_sGcContinueToken || Array.from(byMatchId.keys()).at(-1)
  let pages = 0
  let emptyRetries = 0

  while (continueToken && pages < MAX_PAGES) {
    pages += 1
    const before = byMatchId.size
    const url = new URL(`${location.origin}${location.pathname}`)
    url.searchParams.set('ajax', '1')
    url.searchParams.set('tab', TAB)
    url.searchParams.set('continue_token', continueToken)
    url.searchParams.set('sessionid', window.g_sessionID)

    console.log(`[conduct exporter] loading page ${pages}, token ${continueToken}, rows so far ${byMatchId.size}`)
    const response = await fetch(url, { credentials: 'include' })
    if (response.status === 429) {
      throw new Error('Steam rate-limited the exporter (HTTP 429). Wait a few minutes and run it again.')
    }
    if (!response.ok) {
      throw new Error(`Steam request failed: HTTP ${response.status}`)
    }

    const data = await response.json()
    if (!data.success) {
      throw new Error('Steam returned success=false for the history request.')
    }

    if (data.html) {
      const doc = new DOMParser().parseFromString(data.html, 'text/html')
      addRows(parseTable(findTable(doc)))
    }

    continueToken = data.continue_token || ''
    if (byMatchId.size === before) {
      emptyRetries += 1
      if (emptyRetries > 10) break
    } else {
      emptyRetries = 0
    }

    if (continueToken) await sleep(DELAY_MS)
  }

  const summaries = Array.from(byMatchId.values()).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  const payload = {
    summaries,
    source: 'steam-console-exporter',
    parsedAt: new Date().toISOString(),
    steamPage: location.href,
    pagesFetched: pages,
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'dota2-conduct-history.json'
  link.click()
  URL.revokeObjectURL(link.href)

  console.log(`[conduct exporter] done: ${summaries.length} rows downloaded as dota2-conduct-history.json`)
})().catch((error) => {
  console.error('[conduct exporter] failed:', error)
  alert(`Dota conduct exporter failed: ${error.message}`)
})
