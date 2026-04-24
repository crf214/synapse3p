'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR', 'AP_CLERK'])
const DELETE_ROLES  = new Set(['ADMIN', 'CFO', 'LEGAL'])

type DocType = 'QUOTE'|'PROPOSAL'|'CONTRACT'|'SOW'|'INVOICE'|'RECEIPT'|'APPROVAL'|'COMPLIANCE'|'CERTIFICATE'|'REPORT'|'AMENDMENT'|'OTHER'
type ESignStatus = 'NOT_REQUIRED'|'PENDING'|'SENT'|'SIGNED'|'DECLINED'|'EXPIRED'

interface DocRow {
  id:            string
  title:         string
  docType:       DocType
  source:        string
  mimeType:      string | null
  fileSizeBytes: number | null
  entityId:      string | null
  poId:          string | null
  contractId:    string | null
  status:        string
  expiresAt:     string | null
  eSignRequired: boolean
  eSignStatus:   ESignStatus
  createdAt:     string
  hasFile:       boolean
  entity:        { id: string; name: string } | null
  uploader:      { id: string; name: string | null; email: string } | null
}

const ESIGN_COLOR: Record<ESignStatus, { bg: string; text: string }> = {
  NOT_REQUIRED: { bg: '#f8fafc', text: '#94a3b8' },
  PENDING:      { bg: '#fff7ed', text: '#ea580c' },
  SENT:         { bg: '#eff6ff', text: '#2563eb' },
  SIGNED:       { bg: '#f0fdf4', text: '#16a34a' },
  DECLINED:     { bg: '#fef2f2', text: '#dc2626' },
  EXPIRED:      { bg: '#fef2f2', text: '#dc2626' },
}

const DOCTYPE_ICONS: Record<DocType, string> = {
  QUOTE:       '📋', PROPOSAL: '📝', CONTRACT: '📑', SOW: '📋',
  INVOICE:     '🧾', RECEIPT:  '🧾', APPROVAL: '✅', COMPLIANCE: '🛡',
  CERTIFICATE: '🏆', REPORT:   '📊', AMENDMENT:'🔄', OTHER:      '📄',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtBytes(b: number | null) {
  if (!b) return '—'
  if (b < 1024)       return `${b} B`
  if (b < 1048576)    return `${(b/1024).toFixed(1)} KB`
  return `${(b/1048576).toFixed(1)} MB`
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function DocumentsPage() {
  const user = useUser()

  const [rows,     setRows]     = useState<DocRow[]>([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [docType,  setDocType]  = useState('')
  const [source,   setSource]   = useState('')
  const [q,        setQ]        = useState('')
  const [page,     setPage]     = useState(1)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ page: String(page) })
    if (docType) p.set('docType', docType)
    if (source)  p.set('source',  source)
    if (q)       p.set('q', q)
    try {
      const res = await fetch(`/api/documents?${p}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.documents)
      setTotal(data.total)
    } catch {
      setError('Could not load documents.')
    } finally {
      setLoading(false)
    }
  }, [docType, source, q, page])

  useEffect(() => { setPage(1) }, [docType, source, q])
  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  async function deleteDoc(id: string) {
    if (!confirm('Mark this document as deleted?')) return
    setDeleting(id)
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' })
      await load()
    } catch {
      setError('Failed to delete document.')
    } finally {
      setDeleting(null)
    }
  }

  const activeRows = rows.filter(r => r.status !== 'deleted')

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Documents</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{total} document{total !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search by title…"
          className="px-3 py-2 rounded-xl text-sm w-56"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}
        />
        <select value={docType} onChange={e => setDocType(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          <option value="">All types</option>
          {['CONTRACT','SOW','PROPOSAL','QUOTE','INVOICE','RECEIPT','APPROVAL','COMPLIANCE','CERTIFICATE','REPORT','AMENDMENT','OTHER'].map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={source} onChange={e => setSource(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          <option value="">All sources</option>
          <option value="INTERNAL">Internal</option>
          <option value="VENDOR">Vendor</option>
          <option value="SYSTEM">System</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : activeRows.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium">No documents found</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Title','Type','Entity','Source','Size','eSign','Expires','Uploaded',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRows.map((r, i) => {
                  const expDays = daysUntil(r.expiresAt)
                  const expiring = expDays !== null && expDays >= 0 && expDays <= 30
                  const esign = ESIGN_COLOR[r.eSignStatus]

                  return (
                    <tr key={r.id}
                      style={{ borderBottom: i < activeRows.length - 1 ? '1px solid var(--border)' : undefined, opacity: r.hasFile ? 1 : 0.7 }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{DOCTYPE_ICONS[r.docType] ?? '📄'}</span>
                          <div>
                            <div className="font-medium" style={{ color: 'var(--ink)' }}>{r.title}</div>
                            {!r.hasFile && (
                              <div className="text-xs" style={{ color: '#ea580c' }}>No file uploaded</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{r.docType}</td>
                      <td className="px-4 py-3 text-xs">
                        {r.entity ? (
                          <Link href={`/dashboard/entities/${r.entity.id}`}
                            className="hover:underline" style={{ color: '#2563eb' }}>
                            {r.entity.name}
                          </Link>
                        ) : r.poId ? (
                          <Link href={`/dashboard/purchase-orders/${r.poId}`}
                            className="hover:underline" style={{ color: '#2563eb' }}>
                            View PO
                          </Link>
                        ) : r.contractId ? (
                          <Link href={`/dashboard/contracts/${r.contractId}`}
                            className="hover:underline" style={{ color: '#2563eb' }}>
                            View Contract
                          </Link>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {r.source}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtBytes(r.fileSizeBytes)}
                      </td>
                      <td className="px-4 py-3">
                        {r.eSignRequired ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ background: esign.bg, color: esign.text }}>
                            {r.eSignStatus.replace('_',' ')}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: expiring ? '#ea580c' : 'var(--muted)' }}>
                        {fmtDate(r.expiresAt)}
                        {expiring && expDays !== null && ` (${expDays}d)`}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        <div>{r.uploader?.name ?? r.uploader?.email ?? '—'}</div>
                        <div>{fmtDate(r.createdAt)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {DELETE_ROLES.has(user.role ?? '') && (
                          <button
                            onClick={() => deleteDoc(r.id)}
                            disabled={deleting === r.id}
                            className="px-2 py-1 rounded-lg text-xs"
                            style={{ background: '#fef2f2', color: '#dc2626' }}>
                            {deleting === r.id ? '…' : 'Delete'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 50 && (
            <div className="flex justify-center gap-2 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Previous
              </button>
              <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
