const VALID_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'HKD',
  'SGD', 'NOK', 'SEK', 'DKK', 'NZD', 'MXN', 'BRL', 'INR',
  'CNY', 'ZAR', 'AED', 'SAR',
])

// cuid v1: starts with 'c', followed by 24 lowercase alphanum chars (25 total)
const CUID_RE = /^c[a-z0-9]{24}$/

export function sanitizeString(s: string, maxLength: number): string {
  return s
    .trim()
    .replace(/\0/g, '')   // strip null bytes
    .slice(0, maxLength)
}

export function validateCuid(id: string): boolean {
  return CUID_RE.test(id)
}

export function validateCurrency(currency: string): boolean {
  return VALID_CURRENCIES.has(currency)
}

export function validateAmount(amount: number): boolean {
  return (
    typeof amount === 'number' &&
    isFinite(amount)           &&
    amount > 0                 &&
    amount <= 999_999_999.99
  )
}

export function validateOrgId(orgId: string): boolean {
  return validateCuid(orgId)
}
