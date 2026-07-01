export type ConductSummary = {
  matchId: string
  dateText: string
  timestamp: number | null
  periodic: boolean
  excessiveReports: boolean
  excessiveAbandons: boolean
  matchCount: number
  positiveMatches: number
  reportedMatches: number
  abandonedMatches: number
  reports: number
  reportingParties: number
  commsReports: number
  commsReportingParties: number
  commends: number
  behaviorScore: number
}

export type ParsedConductHistory = {
  summaries: ConductSummary[]
  source: 'steam-html' | 'steam-console-exporter' | 'json-import'
  parsedAt: string
}

const REQUIRED_HEADERS = ['Conduct Summary MatchID', 'Conduct Summary Date', 'Behavior Score']

const HEADER_ALIASES: Record<string, keyof ConductSummary> = {
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

const NUMERIC_FIELDS = new Set<keyof ConductSummary>([
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

const BOOLEAN_FIELDS = new Set<keyof ConductSummary>([
  'periodic',
  'excessiveReports',
  'excessiveAbandons',
])

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function cellText(cell: Element | undefined) {
  return cell?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function parseBoolean(value: string) {
  return /^(yes|true|1|ja)$/i.test(value.trim())
}

function parseNumber(value: string) {
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return 0
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseSteamDate(value: string): number | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT$/i)
  if (!match) {
    const fallback = Date.parse(value)
    return Number.isFinite(fallback) ? fallback : null
  }

  const [, year, month, day, hour, minute, second] = match
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
}

function emptySummary(): ConductSummary {
  return {
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
  }
}

export function findConductSummaryTable(document: Document): HTMLTableElement | null {
  const tables = Array.from(document.querySelectorAll('table'))

  return (
    tables.find((table) => {
      const headers = Array.from(table.querySelectorAll('th')).map((header) => cellText(header))
      return REQUIRED_HEADERS.every((required) => headers.includes(required))
    }) ?? null
  )
}

export function parseConductSummariesFromHtml(html: string): ParsedConductHistory {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const table = findConductSummaryTable(document)

  if (!table) {
    throw new Error(
      'No Conduct Summary table found. Open the Steam link, load the full history with “Load More History”, then save that page as HTML.',
    )
  }

  const headers = Array.from(table.querySelectorAll('tr:first-child th')).map((header) => cellText(header))
  const headerFields = headers.map((header) => HEADER_ALIASES[normalize(header)] ?? null)
  const rows = Array.from(table.querySelectorAll('tr')).slice(1)
  const summaries = rows
    .map((row) => {
      const cells = Array.from(row.querySelectorAll('td'))
      if (cells.length === 0) return null

      const summary = emptySummary()

      headerFields.forEach((field, index) => {
        if (!field) return
        const value = cellText(cells[index])

        if (field === 'dateText') {
          summary.dateText = value
          summary.timestamp = parseSteamDate(value)
        } else if (BOOLEAN_FIELDS.has(field)) {
          ;(summary[field] as boolean) = parseBoolean(value)
        } else if (NUMERIC_FIELDS.has(field)) {
          ;(summary[field] as number) = parseNumber(value)
        } else if (field === 'matchId') {
          summary.matchId = value.replace(/[^0-9]/g, '')
        }
      })

      if (!summary.matchId || !summary.behaviorScore) return null
      return summary
    })
    .filter((summary): summary is ConductSummary => Boolean(summary))

  if (summaries.length === 0) {
    throw new Error('The table was found, but no Conduct Summary rows could be parsed.')
  }

  const unique = new Map<string, ConductSummary>()
  for (const summary of summaries) unique.set(summary.matchId, summary)

  return {
    summaries: Array.from(unique.values()),
    source: 'steam-html',
    parsedAt: new Date().toISOString(),
  }
}

export function sortChronologically(summaries: ConductSummary[]) {
  return [...summaries].sort((a, b) => {
    const byTime = (a.timestamp ?? 0) - (b.timestamp ?? 0)
    if (byTime !== 0) return byTime
    return Number(a.matchId) - Number(b.matchId)
  })
}

export function opendotaMatchUrl(matchId: string) {
  return `https://www.opendota.com/matches/${matchId}`
}

export function toCsv(summaries: ConductSummary[]) {
  const headers: (keyof ConductSummary)[] = [
    'matchId',
    'dateText',
    'periodic',
    'excessiveReports',
    'excessiveAbandons',
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
  ]

  const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`
  return [headers.join(','), ...summaries.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n')
}
