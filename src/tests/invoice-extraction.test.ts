// src/tests/invoice-extraction.test.ts
// Regression test for AI invoice extraction.
// Uses vi.mock to intercept the Anthropic SDK — no real API calls are made.
// Mock values are derived from the real fixture PDF (an Optimum cable bill):
//   - Vendor: Optimum
//   - Invoice/Account#: 07839-385935-03-5
//   - Billing period start (invoiceDate): 2018-08-16
//   - Due date: 2018-08-30
//   - Total: $227.50 USD

import { describe, it, expect, vi, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// vi.hoisted ensures these values are available inside vi.mock factories
// which are hoisted to the top of the file before any imports run.
// ---------------------------------------------------------------------------

const { MOCK_JSON, mockCreate } = vi.hoisted(() => {
  const MOCK_JSON = JSON.stringify({
    vendorName:  { value: 'Optimum',              confidence: 1.0 },
    invoiceNo:   { value: '07839-385935-03-5',    confidence: 1.0 },
    invoiceDate: { value: '2018-08-16',            confidence: 0.9 },
    dueDate:     { value: '2018-08-30',            confidence: 1.0 },
    subtotal:    { value: '219.31',                confidence: 1.0 },
    taxAmount:   { value: '8.19',                  confidence: 1.0 },
    totalAmount: { value: '227.50',                confidence: 1.0 },
    currency:    { value: 'USD',                   confidence: 1.0 },
    poReference: { value: null,                    confidence: 0.0 },
    lineItems:   { value: null,                    confidence: 0.5 },
  })

  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: MOCK_JSON }],
  })

  return { MOCK_JSON, mockCreate }
})

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk — must use `function` so `new Anthropic()` works
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => {
  function AnthropicMock() {
    // @ts-ignore
    this.messages = { create: mockCreate }
  }
  return { default: AnthropicMock }
})

// prisma is imported by invoice-ai.ts but not used by extractFromPdf itself.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

// ---------------------------------------------------------------------------
// Module under test (imported after mocks are registered)
// ---------------------------------------------------------------------------

import { extractFromPdf } from '@/lib/invoice-ai'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Invoice AI extraction — regression against SampleBill 6 Synps.pdf', () => {
  const fixturePath = path.resolve(__dirname, 'fixtures', 'SampleBill 6 Synps.pdf')
  let pdfBase64: string

  beforeAll(() => {
    pdfBase64 = fs.readFileSync(fixturePath).toString('base64')
  })

  it('fixture PDF exists and is non-empty', () => {
    expect(fs.existsSync(fixturePath)).toBe(true)
    expect(pdfBase64.length).toBeGreaterThan(100)
  })

  it('extraction succeeds', async () => {
    const result = await extractFromPdf(pdfBase64)
    expect(result.success).toBe(true)
    expect(result.fields.length).toBeGreaterThan(0)
  })

  it('returns correct invoiceNo', async () => {
    const result = await extractFromPdf(pdfBase64)
    const field = result.fields.find(f => f.fieldName === 'invoiceNo')
    expect(field?.normalizedValue).toBe('07839-385935-03-5')
    expect(field?.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('returns correct vendorName', async () => {
    const result = await extractFromPdf(pdfBase64)
    const field = result.fields.find(f => f.fieldName === 'vendorName')
    expect(field?.normalizedValue).toBe('Optimum')
    expect(field?.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('returns correct totalAmount', async () => {
    const result = await extractFromPdf(pdfBase64)
    const field = result.fields.find(f => f.fieldName === 'totalAmount')
    expect(field?.normalizedValue).toBe('227.50')
    expect(field?.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('returns correct currency', async () => {
    const result = await extractFromPdf(pdfBase64)
    const field = result.fields.find(f => f.fieldName === 'currency')
    expect(field?.normalizedValue).toBe('USD')
    expect(field?.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('returns correct invoiceDate', async () => {
    const result = await extractFromPdf(pdfBase64)
    const field = result.fields.find(f => f.fieldName === 'invoiceDate')
    expect(field?.normalizedValue).toBe('2018-08-16')
    expect(field?.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('all confidence scores are numbers in [0, 1]', async () => {
    const result = await extractFromPdf(pdfBase64)
    for (const field of result.fields) {
      expect(field.confidence).toBeGreaterThanOrEqual(0)
      expect(field.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('needsReview is false for high-confidence fields (confidence=1.0 > threshold 0.85)', async () => {
    const result = await extractFromPdf(pdfBase64)
    const highConfFields = ['vendorName', 'invoiceNo', 'totalAmount', 'currency', 'dueDate']
    for (const name of highConfFields) {
      const field = result.fields.find(f => f.fieldName === name)
      expect(field?.needsReview, `${name} should not need review`).toBe(false)
    }
  })

  it('returns success=false and fallback fields when AI returns malformed JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'NOT_VALID_JSON' }],
    })
    const result = await extractFromPdf(pdfBase64)
    expect(result.success).toBe(false)
    expect(Array.isArray(result.fields)).toBe(true)
    // All fallback fields have confidence 0 and needsReview true
    for (const field of result.fields) {
      expect(field.confidence).toBe(0)
      expect(field.needsReview).toBe(true)
    }
  })
})
