import { describe, expect, it } from 'vitest'
import { opendotaMatchUrl, parseConductSummariesFromHtml, sortChronologically } from './parser'

const fixture = `
<table class="generic_kv_table"><tr>
  <th>Conduct Summary MatchID</th>
  <th>Conduct Summary Date</th>
  <th>Periodic</th>
  <th>Excessive Reports</th>
  <th>Excessive Abandons</th>
  <th>Match Count</th>
  <th>Positive Matches</th>
  <th>Reported Matches</th>
  <th>Abandoned Matches</th>
  <th>Reports</th>
  <th>Reporting Parties</th>
  <th>Comms Reports</th>
  <th>Comms Reporting Parties</th>
  <th>Commends</th>
  <th>Behavior Score</th>
</tr>
<tr><td>8876240560</td><td>2026-07-01 15:55:29 GMT</td><td>Yes</td><td>No</td><td>No</td><td>15</td><td>15</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>60</td><td>4360</td></tr>
<tr><td>8874248118</td><td>2026-06-30 11:28:06 GMT</td><td>Yes</td><td>No</td><td>No</td><td>15</td><td>14</td><td>1</td><td>0</td><td>1</td><td>1</td><td>0</td><td>0</td><td>37</td><td>4180</td></tr>
</table>`

describe('Steam conduct summary parser', () => {
  it('extracts conduct summaries from the saved Steam HTML table', () => {
    const parsed = parseConductSummariesFromHtml(fixture)

    expect(parsed.summaries).toHaveLength(2)
    expect(parsed.summaries[0]).toMatchObject({
      matchId: '8876240560',
      periodic: true,
      reports: 0,
      commends: 60,
      behaviorScore: 4360,
    })
    expect(parsed.summaries[1].timestamp).toBe(Date.UTC(2026, 5, 30, 11, 28, 6))
  })

  it('sorts chronologically for charts', () => {
    const parsed = parseConductSummariesFromHtml(fixture)
    const sorted = sortChronologically(parsed.summaries)

    expect(sorted.map((row) => row.matchId)).toEqual(['8874248118', '8876240560'])
  })

  it('builds OpenDota match links', () => {
    expect(opendotaMatchUrl('8876240560')).toBe('https://www.opendota.com/matches/8876240560')
  })
})
