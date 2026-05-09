'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const READ_ROLES     = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const OVERRIDE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

interface DuplicateOf {
  id:          string
  invoiceNo:   string
  amount:      number
  currency:    string
  invoiceDate: string
}

interface Flag {
  id:          string
  invoiceId:   string
  invoiceNo:   string
  vendorName:  string
  amount:      number
  currency:    string
  status:      string
  detectedAt:  string
  detectedBy:  string
  signals: {
    invoiceNo:    boolean
    vendorAmount: boolean
    pdfHash:      boolean
    emailMsgId:   boolean
  }
  duplicateOf:          DuplicateOf | null
  overriddenBy:         string | null
  overriddenAt:         string | null
  overrideJustification: string | null
  resolutionNotes:      string | null
}

interface Pagination {
  page: number; totalPages: number; hasNext: boolean; hasPrev: boolean; total: number
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function MatchBadge({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Override modal
// ---------------------------------------------------------------------------

function OverrideModal({
  flag,
  onClose,
  onOverridden,
}: {
  flag:        Flag
  onClose:     () => void
  onOverridden: () => void
}) {
  const [justification, setJustification] = useState('')
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  async function submit() {
    if (justification.trim().length < 10) {
      setError('Justification must be at least 10 characters.')
      return
    }
    setSaving(true); setError(null)
    try {
      const res = await apiClient(`/api/invoices/${flag.invoiceId}/override-duplicate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ flagId: flag.id, justification: justification.trim() }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Override failed')
      onOverridden()
    } catch (e) { setError(e instanceof Error ? e.message : 'Override failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-2xl shadow-xl"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>

        <div className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>Override Duplicate Flag</h2>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: 'var(--muted)' }}>×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Invoice summary */}
          <div className="p-3 rounded-lg text-sm space-y-1"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="font-medium" style={{ color: 'var(--ink)' }}>
              {flag.invoiceNo} — {flag.vendorName}
            </div>
            <div style={{ color: 'var(--muted)' }}>{fmt(flag.amount, flag.currency)}</div>
            {flag.duplicateOf && (
              <div className="text-xs pt-1" style={{ color: 'var(--muted)' }}>
                Flagged as duplicate of{' '}
                <Link href={`/dashboard/invoices/${flag.duplicateOf.id}`}
                  className="underline" style={{ color: '#2563eb' }}>
                  {flag.duplicateOf.invoiceNo}
                </Link>{' '}
                ({fmt(flag.duplicateOf.amount, flag.currency)} · {fmtDate(flag.duplicateOf.invoiceDate)})
              </div>
            )}
          </div>

          <div className="p-3 rounded-lg text-xs"
            style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
            <strong style={{ color: '#92400e' }}>Financial control:</strong>
            <span style={{ color: '#78350f' }}> This override is permanently recorded in the audit trail with your identity and justification.</span>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
              Justification * <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(min 10 characters)</span>
            </label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={4}
              placeholder="Explain why this invoice is not a duplicate and should be released for processing…"
              className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
            />
            <div className="text-xs mt-1 text-right" style={{ color: justification.length < 10 ? '#dc2626' : 'var(--muted)' }}>
              {justification.length} / 10 min
            </div>
          </div>

          {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}
        </div>

        <div className="px-6 pb-6 flex justify-end gap-3">
          <button onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)', background: 'var(--bg)' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving || justification.trim().length < 10}
            className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
            style={{ background: '#d97706', color: '#fff' }}>
            {saving ? 'Overriding…' : 'Confirm Override'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Flag row
// ---------------------------------------------------------------------------

function FlagRow({
  flag,
  canOverride,
  onOverride,
}: {
  flag:       Flag
  canOverride: boolean
  onOverride: (f: Flag) => void
}) {
  const matchSignals: string[] = []
  if (flag.signals.pdfHash)      matchSignals.push('Identical PDF')
  if (flag.signals.emailMsgId)   matchSignals.push('Same email')
  if (flag.signals.invoiceNo)    matchSignals.push('Invoice #')
  if (flag.signals.vendorAmount) matchSignals.push('Vendor + amount')

  return (
    <div className="rounded-xl p-4 space-y-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <Link href={`/dashboard/invoices/${flag.invoiceId}`}
              className="text-sm font-semibold hover:underline" style={{ color: 'var(--ink)' }}>
              {flag.invoiceNo}
            </Link>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background: flag.status === 'QUARANTINED' ? '#fef2f2' : '#f0fdf4',
                color:      flag.status === 'QUARANTINED' ? '#dc2626' : '#16a34a',
                border:     `1px solid ${flag.status === 'QUARANTINED' ? '#dc262622' : '#16a34a22'}`,
              }}>
              {flag.status === 'QUARANTINED' ? 'Quarantined' : 'Override approved'}
            </span>
          </div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {flag.vendorName} · {fmt(flag.amount, flag.currency)} · detected {fmtDate(flag.detectedAt)}
          </div>
        </div>

        {canOverride && flag.status === 'QUARANTINED' && (
          <button onClick={() => onOverride(flag)}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
            Override
          </button>
        )}
      </div>

      {/* Match signals */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: 'var(--muted)' }}>Matched on:</span>
        {matchSignals.length > 0
          ? matchSignals.map(s => <MatchBadge key={s} label={s} />)
          : <span className="text-xs" style={{ color: 'var(--muted)' }}>unknown signals</span>
        }
      </div>

      {/* Original invoice */}
      {flag.duplicateOf && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <span>Original:</span>
          <Link href={`/dashboard/invoices/${flag.duplicateOf.id}`}
            className="font-medium hover:underline" style={{ color: '#2563eb' }}>
            {flag.duplicateOf.invoiceNo}
          </Link>
          <span>{fmt(flag.duplicateOf.amount, flag.duplicateOf.currency)}</span>
          <span>· {fmtDate(flag.duplicateOf.invoiceDate)}</span>
        </div>
      )}

      {/* Override record (if already approved) */}
      {flag.status === 'OVERRIDE_APPROVED' && flag.overrideJustification && (
        <div className="text-xs p-2 rounded-lg" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <span style={{ color: '#16a34a', fontWeight: 500 }}>Override justification: </span>
          <span style={{ color: '#166534' }}>{flag.overrideJustification}</span>
          {flag.overriddenAt && (
            <span style={{ color: '#86efac' }}> · {fmtDate(flag.overriddenAt)}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function QuarantinePage() {
  const { role } = useUser()

  const [flags,      setFlags]      = useState<Flag[]>([])
  const [resolved,   setResolved]   = useState<Flag[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page,       setPage]       = useState(1)

  const [overrideTarget, setOverrideTarget] = useState<Flag | null>(null)

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError(null)
    try {
      const [quarRes, resolvedRes] = await Promise.all([
        fetch(`/api/invoices/quarantine?status=QUARANTINED&page=${p}&limit=50`),
        fetch('/api/invoices/quarantine?status=OVERRIDE_APPROVED&limit=20'),
      ])
      const quarJson     = await quarRes.json()     as { flags: Flag[]; pagination: Pagination; error?: { message: string } }
      const resolvedJson = await resolvedRes.json() as { flags: Flag[]; error?: { message: string } }

      if (!quarRes.ok) throw new Error(quarJson.error?.message ?? 'Failed to load')
      setFlags(quarJson.flags)
      setPagination(quarJson.pagination)
      setResolved(resolvedJson.flags ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load(page) }, [load, page])

  if (!role || !READ_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  function handleOverridden() {
    setOverrideTarget(null)
    void load(page)
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>

      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/invoices" className="text-sm" style={{ color: 'var(--muted)' }}>
            ← Invoices
          </Link>
          <span style={{ color: 'var(--muted)' }}>/</span>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Duplicate Quarantine</h1>
          {flags.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>
              {flags.length} pending
            </span>
          )}
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-8">

        {loading && <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>}
        {error   && <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>}

        {/* Quarantined */}
        {!loading && (
          <section>
            {flags.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>No quarantined invoices</p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  Duplicate flags will appear here when the pipeline detects a potential duplicate.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
                  Quarantined ({flags.length})
                </h2>
                <div className="space-y-3">
                  {flags.map(f => (
                    <FlagRow key={f.id} flag={f}
                      canOverride={OVERRIDE_ROLES.has(role)}
                      onOverride={setOverrideTarget}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 text-sm">
                    <button onClick={() => setPage(p => p - 1)} disabled={!pagination.hasPrev}
                      className="px-3 py-1.5 rounded-lg border disabled:opacity-40"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                      Previous
                    </button>
                    <span style={{ color: 'var(--muted)' }}>
                      Page {pagination.page} of {pagination.totalPages}
                    </span>
                    <button onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext}
                      className="px-3 py-1.5 rounded-lg border disabled:opacity-40"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Override history */}
        {resolved.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              Recently Overridden ({resolved.length})
            </h2>
            <div className="space-y-3 opacity-70">
              {resolved.map(f => (
                <FlagRow key={f.id} flag={f}
                  canOverride={false}
                  onOverride={() => {}}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Override modal */}
      {overrideTarget && (
        <OverrideModal
          flag={overrideTarget}
          onClose={() => setOverrideTarget(null)}
          onOverridden={handleOverridden}
        />
      )}
    </div>
  )
}
