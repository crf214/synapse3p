'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])

interface InvoiceOption {
  id:          string
  invoiceNo:   string
  amount:      number
  currency:    string
  status:      string
  invoiceDate: string | null
  entity:      { id: string; name: string }
}

function fmtAmt(v: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function NewMergedAuthPage() {
  const user   = useUser()
  const router = useRouter()

  const [invoices,   setInvoices]  = useState<InvoiceOption[]>([])
  const [selected,   setSelected]  = useState<Set<string>>(new Set())
  const [creditSet,  setCreditSet] = useState<Set<string>>(new Set())
  const [name,       setName]      = useState('')
  const [notes,      setNotes]     = useState('')
  const [search,     setSearch]    = useState('')
  const [loading,    setLoading]   = useState(true)
  const [saving,     setSaving]    = useState(false)
  const [error,      setError]     = useState<string | null>(null)

  const loadInvoices = useCallback(async () => {
    try {
      const res = await fetch('/api/invoices?status=APPROVED&status=MATCHED&pageSize=200')
      if (!res.ok) throw new Error()
      const data = await res.json()
      // Filter out invoices already in a merged auth batch
      setInvoices((data.invoices ?? []).filter((inv: InvoiceOption & { mergedAuthId?: string }) => !inv.mergedAuthId))
    } catch {
      setError('Could not load invoices.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = invoices.filter(inv =>
    inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
    inv.entity.name.toLowerCase().includes(search.toLowerCase())
  )

  // Compute preview totals from selected invoices
  const selectedInvoices = invoices.filter(inv => selected.has(inv.id))
  const currencies = new Set(selectedInvoices.map(inv => inv.currency))
  const mixedCurrency = currencies.size > 1
  const currency     = currencies.size === 1 ? [...currencies][0] : 'USD'
  const totalAmount  = selectedInvoices.filter(i => !creditSet.has(i.id)).reduce((s, i) => s + i.amount, 0)
  const creditAmount = selectedInvoices.filter(i => creditSet.has(i.id)).reduce((s, i)  => s + i.amount, 0)
  const netAmount    = totalAmount - creditAmount

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selected.size < 2) {
      setError('Select at least 2 invoices.')
      return
    }
    if (mixedCurrency) {
      setError('All selected invoices must share the same currency.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const items = [...selected].map(invoiceId => ({
        invoiceId,
        isCredit: creditSet.has(invoiceId),
      }))
      const res = await fetch('/api/merged-authorizations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items, name: name || undefined, notes: notes || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error?.message ?? 'Failed to create batch')
      }
      const { id } = await res.json()
      router.push(`/dashboard/merged-authorizations/${id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create merged authorization.')
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <button onClick={() => router.back()} className="text-sm mb-3 hover:underline" style={{ color: 'var(--muted)' }}>
          ← Back
        </button>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>New Merged Authorization</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Select approved invoices to batch for a single authorization. Credit notes will be netted against charges.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-3 gap-8">
          {/* Invoice selector (left 2/3) */}
          <div className="col-span-2 space-y-4">
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {/* Search bar */}
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    placeholder="Search by invoice # or entity…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="flex-1 text-sm bg-transparent outline-none"
                    style={{ color: 'var(--ink)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {selected.size} selected
                  </span>
                </div>
              </div>

              {/* Invoice list */}
              <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
                {loading ? (
                  <div className="px-4 py-8 text-sm text-center" style={{ color: 'var(--muted)' }}>Loading invoices…</div>
                ) : filtered.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-center" style={{ color: 'var(--muted)' }}>
                    No eligible invoices found.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                        <th className="w-10 px-4 py-2" />
                        {['Invoice #', 'Entity', 'Date', 'Amount', 'Type'].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide"
                            style={{ color: 'var(--muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((inv, i) => {
                        const checked  = selected.has(inv.id)
                        const isCredit = creditSet.has(inv.id)
                        return (
                          <tr key={inv.id}
                            className="transition-colors"
                            style={{
                              borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : undefined,
                              background:   checked ? '#eff6ff' : undefined,
                            }}>
                            <td className="px-4 py-2.5">
                              <input type="checkbox" checked={checked} onChange={() => toggle(inv.id)}
                                className="rounded" style={{ accentColor: '#2563eb' }} />
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs font-medium cursor-pointer hover:underline"
                              style={{ color: '#2563eb' }} onClick={() => toggle(inv.id)}>
                              {inv.invoiceNo}
                            </td>
                            <td className="px-3 py-2.5 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}
                              onClick={() => toggle(inv.id)}>
                              {inv.entity.name}
                            </td>
                            <td className="px-3 py-2.5 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}
                              onClick={() => toggle(inv.id)}>
                              {fmtDate(inv.invoiceDate)}
                            </td>
                            <td className="px-3 py-2.5 text-xs font-medium cursor-pointer"
                              style={{ color: isCredit ? '#16a34a' : 'var(--ink)' }}
                              onClick={() => toggle(inv.id)}>
                              {isCredit ? `−${fmtAmt(inv.amount, inv.currency)}` : fmtAmt(inv.amount, inv.currency)}
                            </td>
                            <td className="px-3 py-2.5">
                              {checked ? (
                                <button type="button"
                                  onClick={() => setCreditSet(prev => {
                                    const next = new Set(prev)
                                    if (next.has(inv.id)) next.delete(inv.id)
                                    else next.add(inv.id)
                                    return next
                                  })}
                                  className="text-xs px-1.5 py-0.5 rounded-full"
                                  style={{
                                    background: isCredit ? '#f0fdf4' : '#f8fafc',
                                    color:      isCredit ? '#16a34a' : '#64748b',
                                    border:     '1px solid currentColor',
                                  }}>
                                  {isCredit ? 'Credit ✓' : 'Invoice'}
                                </button>
                              ) : (
                                <span className="text-xs px-1.5 py-0.5 rounded-full"
                                  style={{ background: '#f8fafc', color: '#64748b' }}>Invoice</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar (right 1/3) */}
          <div className="space-y-4">
            {/* Totals preview */}
            <div className="rounded-2xl p-5 space-y-3" style={{ border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Batch Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--muted)' }}>Invoices</span>
                  <span style={{ color: 'var(--ink)' }}>{selected.size}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--muted)' }}>Subtotal</span>
                  <span style={{ color: 'var(--ink)' }}>
                    {selected.size > 0 && !mixedCurrency ? fmtAmt(totalAmount, currency) : '—'}
                  </span>
                </div>
                {creditAmount > 0 && !mixedCurrency && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--muted)' }}>Credits</span>
                    <span style={{ color: '#16a34a' }}>−{fmtAmt(creditAmount, currency)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 font-semibold" style={{ borderTop: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--ink)' }}>Net Amount</span>
                  <span style={{ color: selected.size > 0 && !mixedCurrency ? '#2563eb' : 'var(--muted)' }}>
                    {selected.size > 0 && !mixedCurrency ? fmtAmt(netAmount, currency) : '—'}
                  </span>
                </div>
              </div>
              {mixedCurrency && (
                <p className="text-xs" style={{ color: '#dc2626' }}>
                  Mixed currencies selected — all invoices must share the same currency.
                </p>
              )}
            </div>

            {/* Metadata */}
            <div className="rounded-2xl p-5 space-y-3" style={{ border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Details</h3>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                  Batch Name (optional)
                </label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Q2 Vendor Payments"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                  Notes (optional)
                </label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Internal notes…"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }} />
              </div>
            </div>

            <button type="submit" disabled={saving || selected.size < 2 || mixedCurrency}
              className="w-full py-2.5 rounded-xl text-sm font-medium disabled:opacity-40"
              style={{ background: '#2563eb', color: '#fff' }}>
              {saving ? 'Creating…' : 'Create Batch'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
