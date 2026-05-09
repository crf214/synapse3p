'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

interface EntityOption { id: string; name: string }

export default function InvoiceUploadPage() {
  const { role }  = useUser()
  const router    = useRouter()
  const inputRef  = useRef<HTMLInputElement>(null)

  const [entities,   setEntities]   = useState<EntityOption[]>([])
  const [file,       setFile]       = useState<File | null>(null)
  const [entityId,   setEntityId]   = useState('')
  const [invoiceNo,  setInvoiceNo]  = useState('')
  const [amount,     setAmount]     = useState('')
  const [dragging,   setDragging]   = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [success,    setSuccess]    = useState<{ id: string } | null>(null)

  useEffect(() => {
    fetch('/api/entities?limit=200')
      .then(r => r.json())
      .then((d: { entities?: EntityOption[] }) => {
        if (d.entities) setEntities(d.entities)
      })
      .catch(() => {})
  }, [])

  const acceptFile = useCallback((f: File) => {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      setError('File too large — maximum 20 MB')
      return
    }
    setError(null)
    setFile(f)
  }, [])

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) acceptFile(f)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) acceptFile(f)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Please select a PDF file'); return }

    setUploading(true)
    setError(null)

    const fd = new FormData()
    fd.append('file', file)
    if (entityId)  fd.append('entityId',  entityId)
    if (invoiceNo) fd.append('invoiceNo', invoiceNo.trim())
    if (amount)    fd.append('amount',    amount.trim())

    try {
      const res  = await apiClient('/api/invoices/upload', { method: 'POST', body: fd })
      const json = await res.json() as { invoice?: { id: string }; error?: { message: string; code?: string } }

      if (!res.ok) {
        if (res.status === 409) {
          setError(`Duplicate invoice: ${json.error?.message ?? 'A PDF with this content already exists'}`)
        } else {
          setError(json.error?.message ?? 'Upload failed')
        }
        return
      }

      setSuccess({ id: json.invoice!.id })
    } catch {
      setError('Network error — please try again')
    } finally {
      setUploading(false)
    }
  }

  if (!role || !ALLOWED_ROLES.has(role)) {
    return (
      <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>
        You do not have permission to upload invoices.
      </div>
    )
  }

  if (success) {
    return (
      <div className="p-8 max-w-lg">
        <div className="rounded-xl p-6 text-center" style={{ background: '#f0fdf4', border: '1px solid #16a34a33' }}>
          <div className="text-3xl mb-3">✓</div>
          <h2 className="text-lg font-semibold mb-1" style={{ color: '#15803d' }}>Invoice uploaded</h2>
          <p className="text-sm mb-5" style={{ color: '#166534' }}>
            The PDF is being processed. You can track it in the invoice queue.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href={`/dashboard/invoices/${success.id}/review`}
              className="px-4 py-2 text-sm rounded-lg font-medium"
              style={{ background: '#16a34a', color: '#fff' }}>
              View Invoice
            </Link>
            <button onClick={() => { setSuccess(null); setFile(null); setInvoiceNo(''); setAmount(''); setEntityId('') }}
              className="px-4 py-2 text-sm rounded-lg border"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              Upload Another
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-xl">
      <div className="mb-6">
        <Link href="/dashboard/invoices"
          className="text-sm mb-2 inline-flex items-center gap-1"
          style={{ color: 'var(--muted)' }}>
          ← Back to Invoices
        </Link>
        <h1 className="text-2xl font-semibold mt-2" style={{ color: 'var(--ink)' }}>Upload Invoice PDF</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Upload a PDF invoice. The AI pipeline will extract the data automatically.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        {/* Drop zone */}
        <div
          className="rounded-xl p-8 text-center cursor-pointer transition-colors"
          style={{
            border: `2px dashed ${dragging ? '#2563eb' : 'var(--border)'}`,
            background: dragging ? '#eff6ff' : 'var(--surface)',
          }}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={onFileChange}
          />
          {file ? (
            <div>
              <div className="text-2xl mb-2">📄</div>
              <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{file.name}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                {(file.size / 1024).toFixed(0)} KB
              </p>
              <button
                type="button"
                className="mt-3 text-xs px-2 py-1 rounded"
                style={{ color: '#dc2626' }}
                onClick={e => { e.stopPropagation(); setFile(null); if (inputRef.current) inputRef.current.value = '' }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div>
              <div className="text-3xl mb-3 opacity-40">↑</div>
              <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                Drop a PDF here or click to browse
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>PDF only · max 20 MB</p>
            </div>
          )}
        </div>

        {/* Optional hints */}
        <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Optional hints (overridden by AI extraction)
          </p>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>Vendor</label>
            <select
              value={entityId}
              onChange={e => setEntityId(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
            >
              <option value="">— Let AI detect vendor —</option>
              {entities.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>Invoice #</label>
              <input
                type="text"
                value={invoiceNo}
                onChange={e => setInvoiceNo(e.target.value)}
                placeholder="e.g. INV-2024-001"
                className="w-full text-sm px-3 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>Amount</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="e.g. 1250.00"
                min="0"
                step="0.01"
                className="w-full text-sm px-3 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg px-4 py-3 text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={uploading || !file}
            className="flex-1 py-2.5 text-sm font-medium rounded-lg disabled:opacity-50 transition-opacity"
            style={{ background: '#2563eb', color: '#fff' }}
          >
            {uploading ? 'Uploading…' : 'Upload Invoice'}
          </button>
          <Link href="/dashboard/invoices"
            className="px-4 py-2.5 text-sm rounded-lg border text-center"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
