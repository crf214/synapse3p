'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractedField { fieldName: string; value: string; confidence: number }

interface InvoiceDetail {
  id:          string
  invoiceNo:   string
  amount:      number
  currency:    string
  invoiceDate: string | null
  dueDate:     string | null
  status:      string
  pdfSignedUrl: string | null
  extractedFields: ExtractedField[]
  decision:    { decision: string; decidedAt: string } | null
}

interface PortalDocument {
  id: string; title: string; docType: string; mimeType: string | null; sizeBytes: number | null; createdAt: string
}

interface Dispute {
  id: string; title: string; description: string | null; occurredAt: string; disputeType: string; status: string
}

const DISPUTE_TYPE_LABELS: Record<string, string> = {
  INCORRECT_AMOUNT: 'Incorrect amount',
  ALREADY_PAID:     'Already paid',
  NOT_ORDERED:      'Goods/services not ordered',
  QUALITY_ISSUE:    'Quality issue',
  WRONG_VENDOR:     'Wrong vendor',
  OTHER:            'Other',
}

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  RECEIVED:       { bg: '#f8fafc', color: '#64748b' },
  MATCHED:        { bg: '#f0fdf4', color: '#16a34a' },
  UNMATCHED:      { bg: '#fffbeb', color: '#d97706' },
  PENDING_REVIEW: { bg: '#fff7ed', color: '#ea580c' },
  APPROVED:       { bg: '#f0fdf4', color: '#16a34a' },
  REJECTED:       { bg: '#fef2f2', color: '#dc2626' },
  PAID:           { bg: '#eff6ff', color: '#2563eb' },
  CANCELLED:      { bg: '#f9fafb', color: '#6b7280' },
  DUPLICATE:      { bg: '#fdf4ff', color: '#9333ea' },
}

const NON_DISPUTABLE = new Set(['PAID', 'CANCELLED', 'REJECTED'])

const FIELD_LABELS: Record<string, string> = {
  vendorName: 'Vendor', invoiceNo: 'Invoice #', invoiceDate: 'Invoice Date',
  dueDate: 'Due Date', subtotal: 'Subtotal', taxAmount: 'Tax',
  totalAmount: 'Total', currency: 'Currency', poReference: 'PO Reference',
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PortalInvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string

  const [invoice,   setInvoice]   = useState<InvoiceDetail | null>(null)
  const [documents, setDocuments] = useState<PortalDocument[]>([])
  const [disputes,  setDisputes]  = useState<Dispute[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  // Active tab
  const [tab, setTab] = useState<'details' | 'documents' | 'dispute'>('details')

  // Dispute form
  const [disputeType,   setDisputeType]   = useState('INCORRECT_AMOUNT')
  const [disputeReason, setDisputeReason] = useState('')
  const [submittingDispute, setSubmittingDispute] = useState(false)
  const [disputeError, setDisputeError] = useState<string | null>(null)
  const [disputeSuccess, setDisputeSuccess] = useState(false)

  // Document upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/portal/invoices/${invoiceId}`)
      const json = await res.json() as {
        invoice: InvoiceDetail; documents: PortalDocument[]; disputes: Dispute[]
        error?: { message: string }
      }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      setInvoice(json.invoice)
      setDocuments(json.documents)
      setDisputes(json.disputes)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoading(false) }
  }, [invoiceId])

  useEffect(() => { void load() }, [load])

  async function submitDispute() {
    if (disputeReason.trim().length < 10) {
      setDisputeError('Reason must be at least 10 characters.')
      return
    }
    setSubmittingDispute(true); setDisputeError(null)
    try {
      const res = await apiClient(`/api/portal/invoices/${invoiceId}/dispute`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ disputeType, reason: disputeReason.trim() }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Submission failed')
      setDisputeSuccess(true)
      setDisputeReason('')
      await load()
    } catch (e) { setDisputeError(e instanceof Error ? e.message : 'Submission failed') }
    finally { setSubmittingDispute(false) }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadError(null); setUploadSuccess(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', file.name)
      const res  = await apiClient(`/api/portal/invoices/${invoiceId}/documents`, { method: 'POST', body: formData })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Upload failed')
      setUploadSuccess(true)
      await load()
    } catch (e) { setUploadError(e instanceof Error ? e.message : 'Upload failed') }
    finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error}</div>
  if (!invoice) return null

  const st = STATUS_COLOR[invoice.status] ?? { bg: '#f8fafc', color: '#64748b' }
  const canDispute = !NON_DISPUTABLE.has(invoice.status)
  const openDisputes = disputes.filter(d => d.status === 'OPEN')

  return (
    <div className="p-6 max-w-3xl mx-auto">

      {/* Breadcrumb + header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm mb-3" style={{ color: 'var(--muted)' }}>
          <button onClick={() => router.push('/portal/invoices')} className="hover:underline">
            ← My Invoices
          </button>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>{invoice.invoiceNo}</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>{invoice.invoiceNo}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm" style={{ color: 'var(--muted)' }}>
              <span>{fmt(invoice.amount, invoice.currency)}</span>
              <span>·</span>
              <span>Due {fmtDate(invoice.dueDate)}</span>
              {openDisputes.length > 0 && (
                <>
                  <span>·</span>
                  <span style={{ color: '#d97706' }}>{openDisputes.length} open dispute{openDisputes.length !== 1 ? 's' : ''}</span>
                </>
              )}
            </div>
          </div>
          <span className="text-xs px-3 py-1.5 rounded-full font-medium flex-shrink-0"
            style={{ background: st.bg, color: st.color }}>
            {invoice.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-6" style={{ borderColor: 'var(--border)' }}>
        {([
          { key: 'details',   label: 'Details'   },
          { key: 'documents', label: `Documents${documents.length > 0 ? ` (${documents.length})` : ''}` },
          { key: 'dispute',   label: `Disputes${disputes.length > 0 ? ` (${disputes.length})` : ''}` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            style={{
              borderBottomColor: tab === t.key ? '#2563eb' : 'transparent',
              color: tab === t.key ? '#2563eb' : 'var(--muted)',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ---- DETAILS TAB ---- */}
      {tab === 'details' && (
        <div className="space-y-6">
          {/* Key fields */}
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide"
              style={{ background: 'var(--surface)', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
              Invoice Details
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {[
                { label: 'Amount',       value: fmt(invoice.amount, invoice.currency) },
                { label: 'Invoice Date', value: fmtDate(invoice.invoiceDate) },
                { label: 'Due Date',     value: fmtDate(invoice.dueDate) },
                { label: 'Status',       value: invoice.status.replace(/_/g, ' ') },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span style={{ color: 'var(--muted)' }}>{row.label}</span>
                  <span className="font-medium" style={{ color: 'var(--ink)' }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Extracted fields */}
          {invoice.extractedFields.filter(f => f.fieldName !== 'lineItems' && f.value).length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide"
                style={{ background: 'var(--surface)', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                AI-Extracted Fields
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {invoice.extractedFields
                  .filter(f => f.fieldName !== 'lineItems' && f.value)
                  .map(f => (
                    <div key={f.fieldName} className="flex items-center justify-between px-4 py-3 text-sm">
                      <span style={{ color: 'var(--muted)' }}>
                        {FIELD_LABELS[f.fieldName] ?? f.fieldName}
                      </span>
                      <span className="font-medium" style={{ color: 'var(--ink)' }}>{f.value}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* PDF viewer */}
          {invoice.pdfSignedUrl && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
                Invoice PDF
              </div>
              <iframe src={invoice.pdfSignedUrl} className="w-full rounded-xl"
                style={{ height: 480, border: '1px solid var(--border)' }} title="Invoice PDF" />
            </div>
          )}
        </div>
      )}

      {/* ---- DOCUMENTS TAB ---- */}
      {tab === 'documents' && (
        <div className="space-y-6">
          {/* Upload area */}
          <div className="p-6 rounded-xl text-center"
            style={{ background: 'var(--surface)', border: '2px dashed var(--border)' }}>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>
              Upload a supporting document
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
              PDF, images, Word, or Excel · max 20 MB
            </p>
            <input ref={fileInputRef} type="file" className="hidden" id="doc-upload"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff,.doc,.docx,.xls,.xlsx"
              onChange={handleFileUpload} />
            <label htmlFor="doc-upload"
              className="inline-block cursor-pointer text-sm px-4 py-2 rounded-lg font-medium"
              style={{ background: '#2563eb', color: '#fff', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? 'Uploading…' : 'Choose file'}
            </label>
            {uploadSuccess && (
              <p className="text-xs mt-3" style={{ color: '#16a34a' }}>Document uploaded successfully.</p>
            )}
            {uploadError && (
              <p className="text-xs mt-3" style={{ color: '#dc2626' }}>{uploadError}</p>
            )}
          </div>

          {/* Existing documents */}
          {documents.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>
              No documents uploaded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
                      {doc.title}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      {doc.mimeType ?? doc.docType}
                      {doc.sizeBytes ? ` · ${fmtBytes(doc.sizeBytes)}` : ''}
                      {' · '}{fmtDate(doc.createdAt)}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full ml-3 flex-shrink-0"
                    style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #16a34a22' }}>
                    Uploaded
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- DISPUTES TAB ---- */}
      {tab === 'dispute' && (
        <div className="space-y-6">

          {/* Raise new dispute */}
          {canDispute ? (
            <div className="rounded-xl p-5 space-y-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div>
                <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>Raise a Dispute</h2>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Use this to flag an issue with this invoice. Our AP team will review and respond.
                </p>
              </div>

              {disputeSuccess && (
                <div className="text-sm px-4 py-3 rounded-lg"
                  style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                  Dispute submitted. Our team will be in touch.
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  Dispute type
                </label>
                <select value={disputeType} onChange={e => setDisputeType(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
                  {Object.entries(DISPUTE_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  Explanation * <span style={{ fontWeight: 400 }}>(min 10 characters)</span>
                </label>
                <textarea value={disputeReason} onChange={e => setDisputeReason(e.target.value)}
                  rows={4} placeholder="Describe the issue in detail…"
                  className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
                <div className="text-xs mt-1 text-right"
                  style={{ color: disputeReason.length < 10 ? '#dc2626' : 'var(--muted)' }}>
                  {disputeReason.length} / 10 min
                </div>
              </div>

              {disputeError && (
                <p className="text-xs" style={{ color: '#dc2626' }}>{disputeError}</p>
              )}

              <button onClick={submitDispute}
                disabled={submittingDispute || disputeReason.trim().length < 10}
                className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}>
                {submittingDispute ? 'Submitting…' : 'Submit Dispute'}
              </button>
            </div>
          ) : (
            <div className="text-sm px-4 py-3 rounded-xl"
              style={{ background: '#f9fafb', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              Disputes cannot be raised on invoices with status <strong>{invoice.status.replace(/_/g, ' ')}</strong>.
            </div>
          )}

          {/* Existing disputes */}
          {disputes.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Submitted Disputes ({disputes.length})
              </h2>
              {disputes.map(d => (
                <div key={d.id} className="rounded-xl px-4 py-3 space-y-1"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                      {DISPUTE_TYPE_LABELS[d.disputeType] ?? d.disputeType}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: d.status === 'OPEN' ? '#fffbeb' : '#f0fdf4',
                        color:      d.status === 'OPEN' ? '#d97706' : '#16a34a',
                        border:     `1px solid ${d.status === 'OPEN' ? '#fde68a' : '#bbf7d0'}`,
                      }}>
                      {d.status}
                    </span>
                  </div>
                  {d.description && (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>{d.description}</p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(d.occurredAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
