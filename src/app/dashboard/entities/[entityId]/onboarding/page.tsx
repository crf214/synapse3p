'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'
import Link from 'next/link'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR', 'AP_CLERK'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface StepDef {
  stepNo:      number
  title:       string
  type:        string
  required:    boolean
  blocksPayment: boolean
  ownerRole:   string
  description: string
}

interface CompletedStep {
  stepNo:      number
  status:      'IN_PROGRESS' | 'COMPLETED'
  completedBy: string
  completedAt: string
  notes:       string
}

interface OnboardingInstance {
  id:             string
  status:         string
  currentStep:    number
  completedSteps: CompletedStep[]
  startedAt:      string | null
  completedAt:    string | null
  workflow: {
    id:    string
    name:  string
    steps: StepDef[]
  }
}

interface NetSuiteMatch {
  erpId:       string
  name:        string
  score:       number
  isExactMatch: boolean
  currency:    string
}

interface CurrentLink {
  erpVendorId:   string
  erpVendorName: string
  erpLinkedAt:   string | null
}

interface EntitySummary {
  id:             string
  name:           string
  legalStructure: string
  jurisdiction:   string | null
  registrationNo: string | null
  primaryCurrency: string
  bankAccounts:   Array<{ id: string; label: string; currency: string; paymentRail: string; isPrimary: boolean }>
  metadata:       Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function stepStatus(stepNo: number, completedSteps: CompletedStep[]): 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' {
  const s = completedSteps.find(c => c.stepNo === stepNo)
  if (!s) return 'NOT_STARTED'
  return s.status
}

function progressPct(steps: StepDef[], completedSteps: CompletedStep[]): number {
  const total = steps.length
  if (!total) return 0
  const done = steps.filter(s => stepStatus(s.stepNo, completedSteps) === 'COMPLETED').length
  return Math.round((done / total) * 100)
}

// ---------------------------------------------------------------------------
// Step status indicator
// ---------------------------------------------------------------------------
function StepIndicator({ status }: { status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' }) {
  if (status === 'COMPLETED') {
    return (
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: '#16a34a', color: '#fff' }}>
        <span style={{ fontSize: 13 }}>✓</span>
      </div>
    )
  }
  if (status === 'IN_PROGRESS') {
    return (
      <div className="w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0"
        style={{ borderColor: '#2563eb', background: '#eff6ff' }}>
        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#2563eb' }} />
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full border-2 flex-shrink-0"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} />
  )
}

// ---------------------------------------------------------------------------
// Step content panels
// ---------------------------------------------------------------------------

function Step1Panel({ entity, onComplete, saving }: {
  entity: EntitySummary
  onComplete: (notes: string) => void
  saving: boolean
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Verify the entity details below are complete and accurate.
      </p>
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {[
          ['Legal name',        entity.name],
          ['Legal structure',   entity.legalStructure],
          ['Jurisdiction',      entity.jurisdiction ?? '—'],
          ['Registration No.',  entity.registrationNo ?? '—'],
          ['Primary currency',  entity.primaryCurrency],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between text-sm">
            <span style={{ color: 'var(--muted)' }}>{label}</span>
            <span className="font-medium" style={{ color: 'var(--ink)' }}>{value}</span>
          </div>
        ))}
      </div>
      <button onClick={() => onComplete('Basic information verified')} disabled={saving}
        className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
        style={{ background: '#16a34a', color: '#fff' }}>
        {saving ? 'Saving…' : 'Mark as verified'}
      </button>
    </div>
  )
}

function ChecklistPanel({ title, checks, textarea, onComplete, saving, canComplete, buttonLabel }: {
  title: string
  checks: string[]
  textarea: string
  onComplete: (notes: string) => void
  saving: boolean
  canComplete: boolean
  buttonLabel: string
}) {
  const [ticked, setTicked]   = useState<Set<number>>(new Set())
  const [notes,  setNotes]    = useState('')

  function toggle(i: number) {
    setTicked(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const allChecked = ticked.size === checks.length

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>{textarea}</label>
        <textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-xl outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
      </div>
      <div className="space-y-2">
        {checks.map((check, i) => (
          <label key={i} className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" checked={ticked.has(i)} onChange={() => toggle(i)}
              className="rounded" />
            {check}
          </label>
        ))}
      </div>
      {!canComplete && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#fffbeb', color: '#d97706' }}>
          You don&apos;t have the required role to complete this step.
        </p>
      )}
      <button onClick={() => onComplete(notes)} disabled={saving || !allChecked || !canComplete}
        className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
        style={{ background: '#16a34a', color: '#fff' }}>
        {saving ? 'Saving…' : buttonLabel}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Legal review panel with file attachment
// ---------------------------------------------------------------------------
interface AttachedDoc {
  id:           string
  title:        string
  docType:      string
  mimeType:     string | null
  fileSizeBytes: number | null
  downloadUrl:  string | null
  uploadedBy:   string
  createdAt:    string
}

function Step2LegalPanel({ entityId, onComplete, saving, canComplete }: {
  entityId:    string
  onComplete:  (notes: string) => void
  saving:      boolean
  canComplete: boolean
}) {
  const CHECKS = ['Sanctions screening clear', 'Regulatory compliance verified', 'No adverse legal history']

  const [ticked,      setTicked]      = useState<Set<number>>(new Set())
  const [notes,       setNotes]       = useState('')
  const [docs,        setDocs]        = useState<AttachedDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [uploading,   setUploading]   = useState(false)
  const [deleting,    setDeleting]    = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [docType,     setDocType]     = useState('CONTRACT')
  const [docTitle,    setDocTitle]    = useState('')

  function toggle(i: number) {
    setTicked(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  }

  const loadDocs = useCallback(async () => {
    setDocsLoading(true)
    try {
      const res = await fetch(`/api/entities/${entityId}/onboarding/attachments`)
      const d = await res.json() as { documents: AttachedDoc[] }
      setDocs(d.documents ?? [])
    } finally {
      setDocsLoading(false)
    }
  }, [entityId])

  useEffect(() => { loadDocs() }, [loadDocs])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file',    file)
      fd.append('docType', docType)
      fd.append('title',   docTitle.trim() || file.name)
      const res = await fetch(`/api/entities/${entityId}/onboarding/attachments`, { method: 'POST', body: fd })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      setDocTitle('')
      e.target.value = ''
      await loadDocs()
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(docId: string) {
    setDeleting(docId)
    try {
      await fetch(`/api/entities/${entityId}/onboarding/attachments?docId=${docId}`, { method: 'DELETE' })
      await loadDocs()
    } finally {
      setDeleting(null)
    }
  }

  function fmtBytes(b: number | null): string {
    if (!b) return ''
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / (1024 * 1024)).toFixed(1)} MB`
  }

  const allChecked = ticked.size === CHECKS.length

  return (
    <div className="space-y-5">
      {/* Checklist */}
      <div className="space-y-2">
        {CHECKS.map((check, i) => (
          <label key={i} className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" checked={ticked.has(i)} onChange={() => toggle(i)} className="rounded" />
            {check}
          </label>
        ))}
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Legal findings</label>
        <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-xl outline-none"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
      </div>

      {/* Attachments section */}
      <div className="rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>Attachments</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>PDF · DOC · DOCX · PNG · JPEG · max 20 MB</span>
        </div>

        {/* Upload controls */}
        {canComplete && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select value={docType} onChange={e => setDocType(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                {['CONTRACT', 'COMPLIANCE', 'CERTIFICATE', 'APPROVAL', 'OTHER'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input value={docTitle} onChange={e => setDocTitle(e.target.value)}
                placeholder="Document title (optional)"
                className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22', opacity: uploading ? 0.5 : 1 }}>
              <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={handleUpload} disabled={uploading} className="hidden" />
              {uploading ? 'Uploading…' : '+ Attach file'}
            </label>
            {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
          </div>
        )}

        {/* Document list */}
        {docsLoading ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>No attachments yet.</p>
        ) : (
          <div className="space-y-1.5">
            {docs.map(d => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: 'var(--ink)' }}>{d.title}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    {d.docType} · {fmtBytes(d.fileSizeBytes)} · {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {d.downloadUrl && (
                    <a href={d.downloadUrl} target="_blank" rel="noreferrer"
                      className="text-xs px-2 py-1 rounded font-medium"
                      style={{ background: '#eff6ff', color: '#2563eb' }}>
                      View
                    </a>
                  )}
                  {canComplete && (
                    <button onClick={() => handleDelete(d.id)} disabled={deleting === d.id}
                      className="text-xs px-2 py-1 rounded font-medium disabled:opacity-40"
                      style={{ background: '#fef2f2', color: '#dc2626' }}>
                      {deleting === d.id ? '…' : 'Del'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!canComplete && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#fffbeb', color: '#d97706' }}>
          You don&apos;t have the required role to complete this step.
        </p>
      )}

      <button onClick={() => onComplete(notes)} disabled={saving || !allChecked || !canComplete}
        className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
        style={{ background: '#16a34a', color: '#fff' }}>
        {saving ? 'Saving…' : 'Complete legal review'}
      </button>
    </div>
  )
}

function Step5Panel({ entity, onComplete, saving, canComplete }: {
  entity: EntitySummary
  onComplete: (notes: string) => void
  saving: boolean
  canComplete: boolean
}) {
  const entityId = entity.id
  const hasBankAccounts = entity.bankAccounts.length > 0

  return (
    <div className="space-y-4">
      {hasBankAccounts ? (
        <>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Verify the bank accounts below are correct before marking this step complete.
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {entity.bankAccounts.map((ba, i) => (
              <div key={ba.id} className="px-4 py-3 flex items-center justify-between"
                style={{ borderBottom: i < entity.bankAccounts.length - 1 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{ba.label}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{ba.currency} · {ba.paymentRail}</div>
                </div>
                {ba.isPrimary && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#2563eb' }}>Primary</span>
                )}
              </div>
            ))}
          </div>
          {!canComplete && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#fffbeb', color: '#d97706' }}>
              You don&apos;t have the required role to complete this step.
            </p>
          )}
          <button onClick={() => onComplete('Bank accounts verified')} disabled={saving || !canComplete}
            className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
            style={{ background: '#16a34a', color: '#fff' }}>
            {saving ? 'Saving…' : 'Complete bank setup'}
          </button>
        </>
      ) : (
        <div className="py-6 text-center space-y-3">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No bank accounts found. Add at least one bank account before completing this step.
          </p>
          <Link href={`/dashboard/entities/${entityId}?tab=bank-accounts`}
            className="inline-block text-sm font-medium px-4 py-2 rounded-xl"
            style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
            → Go to Bank Accounts tab
          </Link>
        </div>
      )}
    </div>
  )
}

function Step6Panel({ entityId, entity, onComplete, saving, canComplete }: {
  entityId: string
  entity: EntitySummary
  onComplete: (notes: string) => void
  saving: boolean
  canComplete: boolean
}) {
  const [matches,      setMatches]      = useState<NetSuiteMatch[]>([])
  const [currentLink,  setCurrentLink]  = useState<CurrentLink | null>(null)
  const [searching,    setSearching]    = useState(false)
  const [linking,      setLinking]      = useState<string | null>(null)
  const [manualId,     setManualId]     = useState('')
  const [manualName,   setManualName]   = useState('')
  const [error,        setError]        = useState<string | null>(null)

  const meta = entity.metadata ?? {}
  const isLinked = !!(meta.erpVendorId)

  async function search() {
    setSearching(true); setError(null)
    try {
      const res = await fetch(`/api/entities/${entityId}/netsuite-match`)
      const d = await res.json() as { matches: NetSuiteMatch[]; currentLink: CurrentLink | null }
      setMatches(d.matches)
      setCurrentLink(d.currentLink)
    } catch { setError('Failed to load matches') }
    finally { setSearching(false) }
  }

  async function confirmLink(erpVendorId: string, erpVendorName: string) {
    setLinking(erpVendorId)
    try {
      const res = await fetch(`/api/entities/${entityId}/netsuite-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erpVendorId, erpVendorName }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onComplete(`Linked to NetSuite vendor: ${erpVendorName} (ID: ${erpVendorId})`)
    } catch { setError('Failed to confirm link') }
    finally { setLinking(null) }
  }

  return (
    <div className="space-y-4">
      {isLinked ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: '#f0fdf4', border: '1px solid #16a34a22' }}>
          <span style={{ color: '#16a34a' }}>✓</span>
          <div>
            <div className="text-sm font-medium" style={{ color: '#16a34a' }}>Linked to NetSuite</div>
            <div className="text-xs" style={{ color: '#16a34a' }}>
              {String(meta.erpVendorName)} (ID: {String(meta.erpVendorId)})
            </div>
          </div>
        </div>
      ) : null}

      {currentLink && !isLinked && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: '#fffbeb', border: '1px solid #d9770622' }}>
          <div className="text-xs" style={{ color: '#d97706' }}>
            Previously linked: {currentLink.erpVendorName} (ID: {currentLink.erpVendorId})
          </div>
        </div>
      )}

      {!isLinked && (
        <>
          <button onClick={search} disabled={searching || !canComplete}
            className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
            style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
            {searching ? 'Searching…' : 'Find NetSuite match'}
          </button>

          {matches.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Top matches from NetSuite:</p>
              {matches.map(m => (
                <div key={m.erpId} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                      {m.name}
                      {m.isExactMatch && <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: '#f0fdf4', color: '#16a34a' }}>Exact match</span>}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                      ID: {m.erpId} · {m.currency}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--border)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(m.score / 10) * 100}%`, background: '#2563eb' }} />
                      </div>
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>{m.score}/10</span>
                    </div>
                  </div>
                  <button onClick={() => confirmLink(m.erpId, m.name)} disabled={!!linking || !canComplete}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-40 flex-shrink-0"
                    style={{ background: '#2563eb', color: '#fff' }}>
                    {linking === m.erpId ? '…' : 'Confirm link'}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2">
            <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>Manual override — enter NetSuite vendor ID directly:</p>
            <div className="flex gap-2">
              <input value={manualId} onChange={e => setManualId(e.target.value)} placeholder="Vendor ID"
                className="text-sm px-3 py-2 rounded-xl w-32 outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Vendor name"
                className="text-sm px-3 py-2 rounded-xl flex-1 outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <button onClick={() => confirmLink(manualId, manualName)} disabled={!manualId || !manualName || !!linking || !canComplete}
                className="text-sm px-3 py-2 rounded-xl disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}>
                Link
              </button>
            </div>
          </div>
        </>
      )}

      {isLinked && (
        <button onClick={() => onComplete(`NetSuite vendor already linked: ${String(meta.erpVendorName)}`)} disabled={saving || !canComplete}
          className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
          style={{ background: '#16a34a', color: '#fff' }}>
          {saving ? 'Saving…' : 'Confirm & continue'}
        </button>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

function Step7Panel({ steps, completedSteps, onComplete, saving, canComplete }: {
  steps:          StepDef[]
  completedSteps: CompletedStep[]
  onComplete:     (notes: string) => void
  saving:         boolean
  canComplete:    boolean
}) {
  const stepsStatus = steps.map(s => ({ ...s, st: stepStatus(s.stepNo, completedSteps) }))
  const allPriorDone = stepsStatus.filter(s => s.stepNo < 7).every(s => s.st === 'COMPLETED')

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Review completion status of all onboarding steps before final approval.
      </p>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {stepsStatus.filter(s => s.stepNo < 7).map((s, i) => (
          <div key={s.stepNo} className="flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: i < 5 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
            <StepIndicator status={s.st} />
            <span className="text-sm" style={{ color: s.st === 'COMPLETED' ? '#16a34a' : 'var(--muted)' }}>{s.title}</span>
          </div>
        ))}
      </div>
      {!allPriorDone && (
        <p className="text-sm px-4 py-3 rounded-xl" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>
          ⚠ All steps 1–6 must be completed before final approval.
        </p>
      )}
      {!canComplete && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#fffbeb', color: '#d97706' }}>
          Only CFO, Controller or Admin may grant final approval.
        </p>
      )}
      <button onClick={() => onComplete('Final approval granted')} disabled={saving || !allPriorDone || !canComplete}
        className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
        style={{ background: allPriorDone && canComplete ? '#16a34a' : 'var(--surface)', color: allPriorDone && canComplete ? '#fff' : 'var(--muted)', border: '1px solid var(--border)' }}>
        {saving ? 'Saving…' : 'Approve entity for payment'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function OnboardingPage() {
  const { role } = useUser()
  const router   = useRouter()
  const params   = useParams()
  const entityId = params.entityId as string

  const [instance,    setInstance]    = useState<OnboardingInstance | null>(null)
  const [entityName,  setEntityName]  = useState('')
  const [entity,      setEntity]      = useState<EntitySummary | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [starting,    setStarting]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [activeStep,  setActiveStep]  = useState(1)
  const [error,       setError]       = useState<string | null>(null)

  const canWrite = role ? ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'].includes(role) : false

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [obRes, entRes] = await Promise.all([
        fetch(`/api/entities/${entityId}/onboarding`),
        fetch(`/api/entities/${entityId}`),
      ])
      const obData  = await obRes.json()  as { instance: OnboardingInstance | null; entityName: string }
      const entData = await entRes.json() as { entity: EntitySummary & { bankAccounts: EntitySummary['bankAccounts'] } }
      setInstance(obData.instance)
      setEntityName(obData.entityName)
      setEntity(entData.entity)
      if (obData.instance) {
        setActiveStep(obData.instance.currentStep)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [entityId])

  useEffect(() => {
    if (!ALLOWED_ROLES.has(role ?? '')) { router.replace('/dashboard'); return }
    loadData()
  }, [role, router, loadData])

  async function startOnboarding() {
    setStarting(true); setError(null)
    try {
      const res = await fetch(`/api/entities/${entityId}/onboarding`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      await loadData()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  async function completeStep(stepNo: number, notes: string) {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/entities/${entityId}/onboarding/steps/${stepNo}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED', notes, completedBy: role ?? 'unknown' }),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      await loadData()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!ALLOWED_ROLES.has(role ?? '')) return null
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>

  // No instance yet
  if (!instance) {
    return (
      <div className="p-8 max-w-2xl">
        <button onClick={() => router.push(`/dashboard/entities/${entityId}`)}
          className="text-xs mb-4 inline-flex items-center gap-1" style={{ color: 'var(--muted)' }}>
          ← {entityName}
        </button>
        <h1 className="font-display text-3xl mb-2" style={{ color: 'var(--ink)' }}>Onboarding: {entityName}</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
          Start the 7-step onboarding workflow to approve this entity for payment.
        </p>
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        {canWrite ? (
          <button onClick={startOnboarding} disabled={starting}
            className="text-sm font-medium px-5 py-2.5 rounded-xl disabled:opacity-50"
            style={{ background: '#2563eb', color: '#fff' }}>
            {starting ? 'Starting…' : 'Start onboarding'}
          </button>
        ) : (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            You need ADMIN or FINANCE_MANAGER role to start onboarding.
          </p>
        )}
      </div>
    )
  }

  const steps = instance.workflow.steps
  const completed = instance.completedSteps
  const pct = progressPct(steps, completed)

  const STEP_CAN_COMPLETE: Record<number, boolean> = {
    1: role ? ['ADMIN', 'FINANCE_MANAGER'].includes(role) : false,
    2: role ? ['ADMIN', 'LEGAL'].includes(role) : false,
    3: role ? ['ADMIN', 'CISO'].includes(role) : false,
    4: role ? ['ADMIN', 'FINANCE_MANAGER'].includes(role) : false,
    5: role ? ['ADMIN', 'FINANCE_MANAGER'].includes(role) : false,
    6: role ? ['ADMIN', 'FINANCE_MANAGER'].includes(role) : false,
    7: role ? ['ADMIN', 'CFO', 'CONTROLLER'].includes(role) : false,
  }

  const activeStepDef = steps.find(s => s.stepNo === activeStep)

  return (
    <div className="p-8 max-w-5xl space-y-6">

      {/* Header */}
      <div>
        <button onClick={() => router.push(`/dashboard/entities/${entityId}`)}
          className="text-xs mb-3 inline-flex items-center gap-1" style={{ color: 'var(--muted)' }}>
          ← {entityName}
        </button>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>Onboarding: {entityName}</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {instance.status === 'COMPLETED' ? 'Completed' : instance.status === 'PENDING_APPROVAL' ? 'Pending final approval' : 'In progress'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-display tabular-nums" style={{ color: '#2563eb' }}>{pct}%</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>complete</div>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#2563eb' }} />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {instance.status === 'COMPLETED' && (
        <div className="px-4 py-3 rounded-xl flex items-center gap-3"
          style={{ background: '#f0fdf4', border: '1px solid #16a34a22' }}>
          <span style={{ color: '#16a34a', fontSize: 18 }}>✓</span>
          <span className="text-sm font-medium" style={{ color: '#16a34a' }}>
            Onboarding complete — entity is approved for payment
          </span>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex gap-6">

        {/* Left: step list */}
        <div className="w-56 flex-shrink-0 space-y-1">
          {steps.map(s => {
            const st = stepStatus(s.stepNo, completed)
            const isActive = activeStep === s.stepNo
            return (
              <button key={s.stepNo} onClick={() => setActiveStep(s.stepNo)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                style={{
                  background: isActive ? '#eff6ff' : 'transparent',
                  border: isActive ? '1px solid #2563eb22' : '1px solid transparent',
                }}>
                <StepIndicator status={st} />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate"
                    style={{ color: isActive ? '#2563eb' : 'var(--ink)' }}>
                    {s.title}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{s.ownerRole}</div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Right: step content */}
        <div className="flex-1 rounded-2xl p-6 space-y-4"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          {activeStepDef && (
            <>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--border)', color: 'var(--muted)' }}>
                    Step {activeStepDef.stepNo}
                  </span>
                  <StepIndicator status={stepStatus(activeStepDef.stepNo, completed)} />
                </div>
                <h2 className="font-display text-xl" style={{ color: 'var(--ink)' }}>{activeStepDef.title}</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{activeStepDef.description}</p>
              </div>

              {activeStep === 1 && entity && (
                <Step1Panel entity={entity} onComplete={n => completeStep(1, n)} saving={saving} />
              )}
              {activeStep === 2 && (
                <Step2LegalPanel
                  entityId={entityId}
                  onComplete={n => completeStep(2, n)}
                  saving={saving}
                  canComplete={STEP_CAN_COMPLETE[2]}
                />
              )}
              {activeStep === 3 && (
                <ChecklistPanel
                  title="Cybersecurity assessment"
                  checks={['SOC2 certificate reviewed', 'Penetration test results reviewed', 'Data handling practices assessed']}
                  textarea="Cyber assessment findings"
                  onComplete={n => completeStep(3, n)}
                  saving={saving}
                  canComplete={STEP_CAN_COMPLETE[3]}
                  buttonLabel="Complete cyber assessment"
                />
              )}
              {activeStep === 4 && (
                <ChecklistPanel
                  title="Data privacy review"
                  checks={['DPA in place', 'GDPR compliance verified', 'Data retention policy reviewed']}
                  textarea="Privacy findings"
                  onComplete={n => completeStep(4, n)}
                  saving={saving}
                  canComplete={STEP_CAN_COMPLETE[4]}
                  buttonLabel="Complete privacy review"
                />
              )}
              {activeStep === 5 && entity && (
                <Step5Panel
                  entity={entity}
                  onComplete={n => completeStep(5, n)}
                  saving={saving}
                  canComplete={STEP_CAN_COMPLETE[5]}
                />
              )}
              {activeStep === 6 && entity && (
                <Step6Panel
                  entityId={entityId}
                  entity={entity}
                  onComplete={n => completeStep(6, n)}
                  saving={saving}
                  canComplete={STEP_CAN_COMPLETE[6]}
                />
              )}
              {activeStep === 7 && (
                <Step7Panel
                  steps={steps}
                  completedSteps={completed}
                  onComplete={n => completeStep(7, n)}
                  saving={saving}
                  canComplete={STEP_CAN_COMPLETE[7]}
                />
              )}

              {/* Show completed notes */}
              {(() => {
                const cs = completed.find(c => c.stepNo === activeStep)
                if (!cs || cs.status !== 'COMPLETED') return null
                return (
                  <div className="pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      Completed by {cs.completedBy} · {new Date(cs.completedAt).toLocaleDateString()}
                    </p>
                    {cs.notes && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{cs.notes}</p>}
                  </div>
                )
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
