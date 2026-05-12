'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

interface DocRow {
  id:          string
  title:       string
  docType:     string
  status:      string
  eSignStatus: string | null
  expiresAt:   string | null
  createdAt:   string
  hasFile:     boolean
  mimeType:    string | null
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

async function downloadDoc(id: string, title: string) {
  const res = await fetch(`/api/portal/documents/${id}/download`)
  if (!res.ok) {
    alert('Could not generate download link. Please try again.')
    return
  }
  const { url } = await res.json() as { url: string; filename: string }
  window.open(url, '_blank', 'noopener')
}

export default function PortalDocumentsPage() {
  const qc        = useQueryClient()
  const fileRef   = useRef<HTMLInputElement>(null)

  const [page,       setPage]       = useState(1)
  const [uploading,  setUploading]  = useState(false)
  const [uploadErr,  setUploadErr]  = useState<string | null>(null)
  const [uploadOk,   setUploadOk]   = useState(false)
  const [invoiceId,  setInvoiceId]  = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.portal.documents.list({ page }),
    queryFn:  async () => {
      const res = await fetch(`/api/portal/documents?page=${page}`)
      if (!res.ok) throw new Error()
      return res.json() as Promise<{ documents: DocRow[]; total: number }>
    },
  })

  // Invoices for the upload selector
  const { data: invData } = useQuery({
    queryKey: queryKeys.portal.invoices.list({ page: 1 }),
    queryFn:  async () => {
      const res = await fetch('/api/portal/invoices?page=1')
      if (!res.ok) throw new Error()
      return res.json() as Promise<{ invoices: { id: string; invoiceNo: string }[]; total: number }>
    },
  })

  const rows    = data?.documents ?? []
  const total   = data?.total     ?? 0
  const invoices = invData?.invoices ?? []

  async function handleUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file) { setUploadErr('Please select a file.'); return }
    if (!invoiceId)  { setUploadErr('Please select an invoice.'); return }

    setUploading(true)
    setUploadErr(null)
    setUploadOk(false)

    const form = new FormData()
    form.append('file',  file)
    form.append('title', file.name)

    try {
      const res = await fetch(`/api/portal/invoices/${invoiceId}/documents`, {
        method: 'POST',
        body:   form,
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } }
        throw new Error(d.error?.message ?? 'Upload failed')
      }
      setUploadOk(true)
      if (fileRef.current) fileRef.current.value = ''
      setInvoiceId('')
      void qc.invalidateQueries({ queryKey: queryKeys.portal.documents.list({ page: 1 }) })
    } catch (e: unknown) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(id: string, title: string) {
    setDownloading(id)
    await downloadDoc(id, title)
    setDownloading(null)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Documents</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          {total} document{total !== 1 ? 's' : ''} on file
        </p>
      </div>

      {/* Upload section */}
      <div className="rounded-2xl p-5" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Upload Supporting Document</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
          Attach supporting documents (PDF, images, Word, Excel — max 20 MB) against one of your invoices.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Invoice *</label>
            <select
              value={invoiceId}
              onChange={e => setInvoiceId(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: '#fff', minWidth: 180 }}>
              <option value="">Select invoice…</option>
              {invoices.map(inv => (
                <option key={inv.id} value={inv.id}>{inv.invoiceNo}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>File *</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff,.doc,.docx,.xls,.xlsx"
              className="text-sm"
              style={{ color: 'var(--ink)' }}
            />
          </div>
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
            style={{ background: '#2563eb', color: '#fff' }}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {uploadErr && <p className="text-xs mt-2" style={{ color: '#dc2626' }}>{uploadErr}</p>}
        {uploadOk  && <p className="text-xs mt-2" style={{ color: '#16a34a' }}>Document uploaded successfully.</p>}
      </div>

      {/* Documents table */}
      {isError && (
        <div className="px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          Could not load documents.
        </div>
      )}

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 rounded-2xl"
          style={{ border: '1px dashed var(--border)', color: 'var(--muted)' }}>
          <p className="text-sm">No documents on file.</p>
          <p className="text-xs mt-1">Upload supporting documents using the form above.</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Document Name', 'Type', 'Uploaded', 'Expires', 'Download'].map(h => (
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

                  return (
                    <tr key={doc.id}
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3 font-medium text-sm" style={{ color: 'var(--ink)' }}>
                        {doc.title}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {doc.docType.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtDate(doc.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs"
                        style={{ color: expired ? '#dc2626' : expiring ? '#ea580c' : 'var(--muted)' }}>
                        {fmtDate(doc.expiresAt)}
                        {expired  && <span className="ml-1 font-medium">(expired)</span>}
                        {expiring && !expired && <span className="ml-1">({days}d)</span>}
                      </td>
                      <td className="px-4 py-3">
                        {doc.hasFile ? (
                          <button
                            onClick={() => void handleDownload(doc.id, doc.title)}
                            disabled={downloading === doc.id}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 transition-colors hover:bg-blue-50"
                            style={{ border: '1px solid #2563eb22', color: '#2563eb', background: '#eff6ff' }}>
                            {downloading === doc.id ? '…' : 'Download'}
                          </button>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>No file</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {total > 20 && (
            <div className="flex justify-center gap-2">
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
