// ---------------------------------------------------------------------------
// sanitiseString
// ---------------------------------------------------------------------------

// Unicode direction override characters (bidi spoofing)
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069\u200F\u200E]/g
// Zero-width / invisible characters
const ZERO_WIDTH_RE = /[\u200B\uFEFF\u00AD]/g
// Null bytes
const NULL_BYTE_RE = /\x00/g

export function sanitiseString(value: unknown, maxLength = 1000): string {
  const str = typeof value === 'string' ? value : String(value)
  return str
    .replace(NULL_BYTE_RE,   '')
    .replace(BIDI_RE,        '')
    .replace(ZERO_WIDTH_RE,  '')
    .trim()
    .slice(0, maxLength)
}

// ---------------------------------------------------------------------------
// sanitiseUrl
// ---------------------------------------------------------------------------

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export function sanitiseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null
  return parsed.href
}

// ---------------------------------------------------------------------------
// sanitiseNumber
// ---------------------------------------------------------------------------

export function sanitiseNumber(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number | null {
  if (typeof value !== 'number') return null
  if (!isFinite(value) || isNaN(value)) return null
  if (value < min || value > max) return null
  return value
}

// ---------------------------------------------------------------------------
// sanitiseNewsArticle
// ---------------------------------------------------------------------------

export interface SanitisedArticle {
  title:       string
  description: string
  url:         string | null
  sourceName:  string
  publishedAt: string
}

export function sanitiseNewsArticle(article: unknown): SanitisedArticle | null {
  if (typeof article !== 'object' || article === null) return null

  const a = article as Record<string, unknown>

  const title = sanitiseString(a['title'] ?? '', 500)
  if (!title) return null   // missing or empty title is unacceptable

  return {
    title,
    description: sanitiseString(a['description'] ?? '', 2000),
    url:         sanitiseUrl(a['url']),
    sourceName:  sanitiseString(
      (a['source'] as Record<string, unknown> | null)?.['name'] ?? a['sourceName'] ?? '',
      200,
    ),
    publishedAt: sanitiseString(a['publishedAt'] ?? '', 50),
  }
}

// ---------------------------------------------------------------------------
// sanitiseStockData
// ---------------------------------------------------------------------------

export interface SanitisedStockData {
  ticker:        string
  previousClose: number | null
  lastClose:     number | null
}

export function sanitiseStockData(data: unknown): SanitisedStockData | null {
  if (typeof data !== 'object' || data === null) return null

  const d = data as Record<string, unknown>

  // Expect either a raw Yahoo Finance result array or a pre-extracted { ticker, prev, latest }
  if ('ticker' in d) {
    const ticker = sanitiseString(d['ticker'] ?? '', 20)
    if (!ticker) return null
    return {
      ticker,
      previousClose: sanitiseNumber(d['prev']    ?? d['previousClose'], -1e9, 1e9),
      lastClose:     sanitiseNumber(d['latest']   ?? d['lastClose'],     -1e9, 1e9),
    }
  }

  // Raw Yahoo Finance chart result shape
  if ('chart' in d) {
    const chart = d['chart'] as Record<string, unknown>
    const result = (chart['result'] as unknown[] | undefined)?.[0]
    if (typeof result !== 'object' || result === null) return null

    const r = result as Record<string, unknown>
    const meta = r['meta'] as Record<string, unknown> | undefined
    const ticker = sanitiseString(meta?.['symbol'] ?? '', 20)

    const closes: unknown[] =
      ((r['indicators'] as Record<string, unknown>)?.['quote'] as unknown[])?.[0]
      // @ts-expect-error dynamic
      ?.close ?? []

    const valid = closes
      .map(c => sanitiseNumber(c, -1e9, 1e9))
      .filter((c): c is number => c !== null)

    if (valid.length < 2) return null

    return {
      ticker,
      previousClose: valid[valid.length - 2],
      lastClose:     valid[valid.length - 1],
    }
  }

  return null
}
