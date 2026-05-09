'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

interface DocRow {
  id: string; title: string; docType: string; status: string
  eSignStatus: string | null; expiresAt: string | null; createdAt: string
}

const ESIGN_COLOR: Record<string, { bg: string; text: string }> = {
  PENDING:   { bg: '#fff7ed', text: '#ea580c' },
  SENT:      { bg: '#eff6ff', text: '#2563eb' },
  SIGNED:    { bg: '#f0fdf4', text: '#16a34a' },
  DECLINED:  { bg: '#fef2f2', text: '#dc2626' },
  EXPIRED:   { bg: '#f1f5f9', text: '#475569' },
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function PortalDocumentsPage() {
  const [page, setPage] = useState(1)

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.portal.documents.list({ page }),
    queryFn:  async () => {
      const res = await fetch(`/api/portal/documents?page=${page}`)
      if (!res.ok) throw new Error()
      return res.json() as Promise<{ documents: DocRow[]; total: number }>
    },
  })

  const rows  = data?.documents ?? []
  const total = data?.total     ?? 0

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>My Documents</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{total} document{total !== 1 ? 's' : ''}</p>
      </div>

      {isError && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          Could not load documents.
        </div>
      )}

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--muted)' }}>No documents found.</div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Title', 'Type', 'eSign', 'Expires', 'Added'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((doc, i) => {
                  const days     = daysUntil(doc.expiresAt)
                  const expiring = days !== null && days >= 0 && days <= 30
                  const expired  = days !== null && days < 0
                  const eCol     = doc.eSignStatus ? (ESIGN_COLOR[doc.eSignStatus] ?? { bg: '#f8fafc', text: '#64748b' }) : null

                  return (
                    <tr key={doc.id}
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3 font-medium text-sm" style={{ color: 'var(--ink)' }}>
                        {doc.title}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {doc.docType.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3">
                        {eCol ? (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: eCol.bg, color: eCol.text }}>
                            {doc.eSignStatus}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs"
                        style={{ color: expired ? '#dc2626' : expiring ? '#ea580c' : 'var(--muted)' }}>
                        {fmtDate(doc.expiresAt)}
                        {expired  && <span className="ml-1 font-medium">(expired)</span>}
                        {expiring && !expired && <span className="ml-1">({days}d)</span>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtDate(doc.createdAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {total > 20 && (
            <div className="flex justify-center gap-2 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Previous</button>
              <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                Page {page} of {Math.ceil(total / 20)}
              </span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 20)}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
