// src/lib/invoice-ai.ts
// Claude-powered invoice field extraction. Accepts a base64-encoded PDF or
// plain text body and returns per-field extraction results with confidence
// scores. All errors are caught internally — callers always receive a result,
// even if extraction partially failed.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldName =
  | 'vendorName'
  | 'invoiceNo'
  | 'invoiceDate'
  | 'dueDate'
  | 'subtotal'
  | 'taxAmount'
  | 'totalAmount'
  | 'currency'
  | 'poReference'
  | 'lineItems'

export interface ExtractedField {
  fieldName:       FieldName
  rawValue:        string | null
  normalizedValue: string | null
  confidence:      number   // 0.0 – 1.0
  needsReview:     boolean
}

export interface ExtractionResult {
  fields:       ExtractedField[]
  rawResponse:  string
  success:      boolean
  errorDetail?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.85
const MODEL = 'claude-sonnet-4-6'

const EXTRACTION_PROMPT = `You are an invoice extraction engine. Extract the following fields from the invoice document and return ONLY valid JSON with no markdown, no code blocks, no explanation.

Required JSON shape:
{
  "vendorName":   { "value": string | null, "confidence": 0.0-1.0 },
  "invoiceNo":    { "value": string | null, "confidence": 0.0-1.0 },
  "invoiceDate":  { "value": "YYYY-MM-DD" | null, "confidence": 0.0-1.0 },
  "dueDate":      { "value": "YYYY-MM-DD" | null, "confidence": 0.0-1.0 },
  "subtotal":     { "value": string | null, "confidence": 0.0-1.0 },
  "taxAmount":    { "value": string | null, "confidence": 0.0-1.0 },
  "totalAmount":  { "value": string | null, "confidence": 0.0-1.0 },
  "currency":     { "value": "ISO-4217 code" | null, "confidence": 0.0-1.0 },
  "poReference":  { "value": string | null, "confidence": 0.0-1.0 },
  "lineItems":    { "value": "[{description, qty, unitPrice, total}]" | null, "confidence": 0.0-1.0 }
}

Rules:
- All monetary values as plain numeric strings (e.g. "1234.56"), no currency symbols.
- All dates in ISO 8601 format (YYYY-MM-DD).
- lineItems.value is a JSON-serialised array string.
- Set confidence to 0.0 if a field is absent and cannot be inferred.
- Set confidence to 1.0 only if the value is explicitly printed and unambiguous.
- Return ONLY the JSON object, nothing else.`

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

export async function extractFromPdf(pdfBase64: string): Promise<ExtractionResult> {
  return _runExtraction([
    {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: pdfBase64,
      },
    },
    { type: 'text' as const, text: EXTRACTION_PROMPT },
  ])
}

export async function extractFromText(text: string): Promise<ExtractionResult> {
  return _runExtraction([
    {
      type: 'text' as const,
      text: `Invoice content:\n\n${text}\n\n${EXTRACTION_PROMPT}`,
    },
  ])
}

async function _runExtraction(content: Anthropic.MessageParam['content']): Promise<ExtractionResult> {
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    })

    const rawResponse = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('')

    return _parseResponse(rawResponse)
  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err)
    console.error('[invoice-ai] extraction failed:', errorDetail)
    return {
      fields: _fallbackFields(),
      rawResponse: '',
      success: false,
      errorDetail,
    }
  }
}

function _parseResponse(rawResponse: string): ExtractionResult {
  try {
    // Strip any accidental markdown fences
    const json = rawResponse.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim()
    const parsed = JSON.parse(json) as Record<string, { value: unknown; confidence: number }>

    const fields: ExtractedField[] = (
      ['vendorName', 'invoiceNo', 'invoiceDate', 'dueDate', 'subtotal', 'taxAmount', 'totalAmount', 'currency', 'poReference', 'lineItems'] as FieldName[]
    ).map(fieldName => {
      const entry = parsed[fieldName] ?? { value: null, confidence: 0 }
      const rawValue = entry.value != null ? String(entry.value) : null
      const confidence = Math.max(0, Math.min(1, Number(entry.confidence) || 0))
      return {
        fieldName,
        rawValue,
        normalizedValue: rawValue,
        confidence,
        needsReview: confidence < CONFIDENCE_THRESHOLD,
      }
    })

    return { fields, rawResponse, success: true }
  } catch (err) {
    console.error('[invoice-ai] JSON parse failed:', err, 'raw:', rawResponse.slice(0, 500))
    return {
      fields: _fallbackFields(),
      rawResponse,
      success: false,
      errorDetail: 'Failed to parse AI response as JSON',
    }
  }
}

function _fallbackFields(): ExtractedField[] {
  const names: FieldName[] = ['vendorName', 'invoiceNo', 'invoiceDate', 'dueDate', 'subtotal', 'taxAmount', 'totalAmount', 'currency', 'poReference', 'lineItems']
  return names.map(fieldName => ({
    fieldName,
    rawValue: null,
    normalizedValue: null,
    confidence: 0,
    needsReview: true,
  }))
}

// ---------------------------------------------------------------------------
// Persist extracted fields to DB
// ---------------------------------------------------------------------------

export async function persistExtractionFields(
  invoiceId: string,
  result: ExtractionResult,
  modelVersion = MODEL,
): Promise<void> {
  // Upsert each field (extraction may run more than once on re-process)
  await Promise.all(
    result.fields.map(f =>
      prisma.invoiceExtractedField.upsert({
        where: { invoiceId_fieldName: { invoiceId, fieldName: f.fieldName } },
        create: {
          invoiceId,
          fieldName:       f.fieldName,
          rawValue:        f.rawValue,
          normalizedValue: f.normalizedValue,
          confidence:      f.confidence,
          needsReview:     f.needsReview,
          modelVersion,
        },
        update: {
          rawValue:        f.rawValue,
          normalizedValue: f.normalizedValue,
          confidence:      f.confidence,
          needsReview:     f.needsReview,
          modelVersion,
          reviewedBy:      null,
          reviewedAt:      null,
          reviewedValue:   null,
        },
      }),
    ),
  )

  // Back-fill Invoice.invoiceNo and Invoice.amount from high-confidence fields
  const byField = Object.fromEntries(result.fields.map(f => [f.fieldName, f]))
  const updates: Record<string, unknown> = {
    rawExtraction: JSON.parse(result.rawResponse || '{}') as Record<string, unknown>,
  }

  const invoiceNoField = byField['invoiceNo']
  if (invoiceNoField?.normalizedValue && invoiceNoField.confidence >= CONFIDENCE_THRESHOLD) {
    updates.invoiceNo = invoiceNoField.normalizedValue
  }

  const amountField = byField['totalAmount']
  if (amountField?.normalizedValue && amountField.confidence >= CONFIDENCE_THRESHOLD) {
    const parsed = parseFloat(amountField.normalizedValue)
    if (!isNaN(parsed)) updates.amount = parsed
  }

  const currencyField = byField['currency']
  if (currencyField?.normalizedValue && currencyField.confidence >= CONFIDENCE_THRESHOLD) {
    updates.currency = currencyField.normalizedValue
  }

  const invoiceDateField = byField['invoiceDate']
  if (invoiceDateField?.normalizedValue && invoiceDateField.confidence >= CONFIDENCE_THRESHOLD) {
    const d = new Date(invoiceDateField.normalizedValue)
    if (!isNaN(d.getTime())) updates.invoiceDate = d
  }

  const dueDateField = byField['dueDate']
  if (dueDateField?.normalizedValue && dueDateField.confidence >= CONFIDENCE_THRESHOLD) {
    const d = new Date(dueDateField.normalizedValue)
    if (!isNaN(d.getTime())) updates.dueDate = d
  }

  if (Object.keys(updates).length > 0) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: updates as Parameters<typeof prisma.invoice.update>[0]['data'],
    })
  }
}
