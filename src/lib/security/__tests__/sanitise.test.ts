import { describe, it, expect } from 'vitest'
import {
  sanitiseString,
  sanitiseUrl,
  sanitiseNumber,
  sanitiseNewsArticle,
  sanitiseStockData,
} from '../sanitise'

// ---------------------------------------------------------------------------
// sanitiseString
// ---------------------------------------------------------------------------

describe('sanitiseString', () => {
  it('removes null bytes', () => {
    expect(sanitiseString('hello\x00world')).toBe('helloworld')
  })

  it('removes multiple null bytes', () => {
    expect(sanitiseString('\x00\x00evil\x00')).toBe('evil')
  })

  it('removes Unicode direction override characters (bidi spoofing)', () => {
    // U+202E is RIGHT-TO-LEFT OVERRIDE — used to spoof filenames/text direction
    expect(sanitiseString('safe\u202Eevil')).toBe('safeevil')
    expect(sanitiseString('\u202Astart\u202B')).toBe('start')
    expect(sanitiseString('\u2066[\u2069')).toBe('[')
    expect(sanitiseString('\u200F\u200E')).toBe('')
  })

  it('removes zero-width characters', () => {
    expect(sanitiseString('hel\u200Blo')).toBe('hello')    // zero-width space
    expect(sanitiseString('by\uFEFFte')).toBe('byte')       // BOM / zero-width no-break
    expect(sanitiseString('so\u00ADft')).toBe('soft')       // soft hyphen
  })

  it('trims surrounding whitespace', () => {
    expect(sanitiseString('  padded  ')).toBe('padded')
  })

  it('truncates to maxLength', () => {
    const long = 'a'.repeat(2000)
    expect(sanitiseString(long, 100)).toHaveLength(100)
  })

  it('converts non-string input to string', () => {
    expect(sanitiseString(42)).toBe('42')
    expect(sanitiseString(null)).toBe('null')
    expect(sanitiseString(true)).toBe('true')
    expect(sanitiseString({ toString: () => 'obj' })).toBe('obj')
  })

  it('handles empty string', () => {
    expect(sanitiseString('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// sanitiseUrl
// ---------------------------------------------------------------------------

describe('sanitiseUrl', () => {
  it('allows a valid https URL', () => {
    const result = sanitiseUrl('https://newsapi.org/v2/everything?q=apple')
    expect(result).toBe('https://newsapi.org/v2/everything?q=apple')
  })

  it('allows a valid http URL', () => {
    const result = sanitiseUrl('http://example.com/page')
    expect(result).toBe('http://example.com/page')
  })

  it('blocks ftp: protocol', () => {
    expect(sanitiseUrl('ftp://files.example.com/data')).toBeNull()
  })

  it('blocks javascript: protocol', () => {
    expect(sanitiseUrl('javascript:alert(1)')).toBeNull()
  })

  it('blocks data: protocol', () => {
    expect(sanitiseUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('returns null for invalid URL string', () => {
    expect(sanitiseUrl('not a url at all')).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(sanitiseUrl(null)).toBeNull()
    expect(sanitiseUrl(42)).toBeNull()
    expect(sanitiseUrl({})).toBeNull()
  })

  it('normalises the URL via href', () => {
    // URL constructor normalises trailing slash on origins
    const result = sanitiseUrl('HTTPS://Example.COM/Path')
    expect(result).toBe('https://example.com/Path')
  })
})

// ---------------------------------------------------------------------------
// sanitiseNumber
// ---------------------------------------------------------------------------

describe('sanitiseNumber', () => {
  it('returns a valid number unchanged', () => {
    expect(sanitiseNumber(42.5)).toBe(42.5)
    expect(sanitiseNumber(0)).toBe(0)
  })

  it('returns null for NaN', () => {
    expect(sanitiseNumber(NaN)).toBeNull()
  })

  it('returns null for positive Infinity', () => {
    expect(sanitiseNumber(Infinity)).toBeNull()
  })

  it('returns null for negative Infinity', () => {
    expect(sanitiseNumber(-Infinity)).toBeNull()
  })

  it('returns null for non-number types', () => {
    expect(sanitiseNumber('42')).toBeNull()
    expect(sanitiseNumber(null)).toBeNull()
    expect(sanitiseNumber(undefined)).toBeNull()
  })

  it('returns null when below min', () => {
    expect(sanitiseNumber(-1, 0, 100)).toBeNull()
  })

  it('returns null when above max', () => {
    expect(sanitiseNumber(101, 0, 100)).toBeNull()
  })

  it('returns value at exact boundaries', () => {
    expect(sanitiseNumber(0, 0, 100)).toBe(0)
    expect(sanitiseNumber(100, 0, 100)).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// sanitiseNewsArticle
// ---------------------------------------------------------------------------

describe('sanitiseNewsArticle', () => {
  const validArticle = {
    title:       'Apple Reports Record Earnings',
    description: 'Apple Inc. reported record quarterly earnings on Thursday.',
    url:         'https://example.com/article/apple-earnings',
    source:      { name: 'Reuters' },
    publishedAt: '2026-04-18T10:00:00Z',
  }

  it('passes a valid well-formed article through', () => {
    const result = sanitiseNewsArticle(validArticle)
    expect(result).not.toBeNull()
    expect(result!.title).toBe('Apple Reports Record Earnings')
    expect(result!.sourceName).toBe('Reuters')
    expect(result!.url).toBe('https://example.com/article/apple-earnings')
  })

  it('returns null when title is missing', () => {
    const { title: _, ...noTitle } = validArticle
    expect(sanitiseNewsArticle(noTitle)).toBeNull()
  })

  it('returns null when title is empty after sanitising', () => {
    expect(sanitiseNewsArticle({ ...validArticle, title: '\x00\u200B\u202E' })).toBeNull()
  })

  it('cleans null bytes from title', () => {
    const result = sanitiseNewsArticle({ ...validArticle, title: 'Apple\x00Earnings' })
    expect(result!.title).toBe('AppleEarnings')
  })

  it('cleans bidi override characters from title', () => {
    const result = sanitiseNewsArticle({ ...validArticle, title: 'Safe\u202EEvil Title' })
    expect(result!.title).toBe('SafeEvil Title')
  })

  it('sanitises url — rejects non-http protocol', () => {
    const result = sanitiseNewsArticle({ ...validArticle, url: 'javascript:alert(1)' })
    expect(result!.url).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(sanitiseNewsArticle(null)).toBeNull()
    expect(sanitiseNewsArticle('string')).toBeNull()
    expect(sanitiseNewsArticle(42)).toBeNull()
  })

  it('truncates description to 2000 chars', () => {
    const result = sanitiseNewsArticle({ ...validArticle, description: 'x'.repeat(3000) })
    expect(result!.description).toHaveLength(2000)
  })
})

// ---------------------------------------------------------------------------
// sanitiseStockData
// ---------------------------------------------------------------------------

describe('sanitiseStockData', () => {
  it('passes valid pre-extracted stock data', () => {
    const result = sanitiseStockData({ ticker: 'AAPL', prev: 171.88, latest: 168.33 })
    expect(result).not.toBeNull()
    expect(result!.ticker).toBe('AAPL')
    expect(result!.previousClose).toBe(171.88)
    expect(result!.lastClose).toBe(168.33)
  })

  it('sanitises close prices — returns null for NaN values', () => {
    const result = sanitiseStockData({ ticker: 'AAPL', prev: NaN, latest: 168.33 })
    expect(result!.previousClose).toBeNull()
  })

  it('sanitises close prices — returns null for Infinity', () => {
    const result = sanitiseStockData({ ticker: 'AAPL', prev: 171.88, latest: Infinity })
    expect(result!.lastClose).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(sanitiseStockData(null)).toBeNull()
    expect(sanitiseStockData('AAPL')).toBeNull()
    expect(sanitiseStockData(42)).toBeNull()
  })

  it('returns null for an empty object', () => {
    expect(sanitiseStockData({})).toBeNull()
  })

  it('returns null when ticker is missing from pre-extracted shape', () => {
    expect(sanitiseStockData({ prev: 100, latest: 95 })).toBeNull()
  })
})
