'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])

interface EntityOption { id: string; name: string }
interface PoOption     { id: string; poNumber: string; title: string }

const CONTRACT_TYPES = ['MASTER','SOW','AMENDMENT','NDA','SLA','FRAMEWORK','OTHER']
const CURRENCIES     = ['USD','EUR','GBP','CAD','AUD','SGD','JPY']

export default function NewContractPage() {
  const user   = useUser()
  const router = useRouter()

  const [entities,  setEntities]  = useState<EntityOption[]>([])
  const [poOptions, setPoOptions] = useState<PoOption[]>([])

  const [form, setForm] = useState({
    contractNo:       '',
    type:             'MASTER',
    entityId:         '',
    value:            '',
    currency:         'USD',
    startDate:        '',
    endDate:          '',
    renewalDate:      '',
    autoRenew:        false,
    noticePeriodDays: '30',
    linkedPoId:       '',
    notes:            '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/entities?limit=200')
      .then(r => r.json())
      .then(d => setEntities((d.entities ?? []).map((e: EntityOption) => ({ id: e.id, name: e.name }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!form.entityId) { setPoOptions([]); return }
    fetch(`/api/purchase-orders/contracts?entityId=${form.entityId}`)
      .then(r => r.json())
      .then(d => setPoOptions(d.contracts ?? []))
      .catch(() => {})
  }, [form.entityId])

  if (!WRITE_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  function set(k: string, v: unknown) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          value:            form.value ? Number(form.value) : null,
          noticePeriodDays: Number(form.noticePeriodDays),
          linkedPoId:       form.linkedPoId || null,
          startDate:        form.startDate  || null,
          endDate:          form.endDate    || null,
          renewalDate:      form.renewalDate|| null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create contract')
      router.push(`/dashboard/contracts/${data.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, node: React.ReactNode, required = false) => (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink)' }}>
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      {node}
    </div>
  )

  const inputCls = "w-full px-3 py-2 rounded-xl text-sm"
  const inputStyle = { border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <button onClick={() => router.back()} className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
          ← Back
        </button>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>New Contract</h1>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          {field('Contract Number', (
            <input
              value={form.contractNo}
              onChange={e => set('contractNo', e.target.value)}
              required
              placeholder="e.g. CONT-2026-001"
              className={inputCls} style={inputStyle}
            />
          ), true)}

          {field('Type', (
            <select value={form.type} onChange={e => set('type', e.target.value)}
              className={inputCls} style={inputStyle}>
              {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ), true)}
        </div>

        {field('Entity (Counterparty)', (
          <select value={form.entityId} onChange={e => set('entityId', e.target.value)} required
            className={inputCls} style={inputStyle}>
            <option value="">Select entity…</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        ), true)}

        <div className="grid grid-cols-2 gap-4">
          {field('Contract Value', (
            <input type="number" min="0" step="0.01"
              value={form.value}
              onChange={e => set('value', e.target.value)}
              placeholder="0.00"
              className={inputCls} style={inputStyle}
            />
          ))}
          {field('Currency', (
            <select value={form.currency} onChange={e => set('currency', e.target.value)}
              className={inputCls} style={inputStyle}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {field('Start Date', (
            <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)}
              className={inputCls} style={inputStyle}
            />
          ))}
          {field('End Date', (
            <input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)}
              className={inputCls} style={inputStyle}
            />
          ))}
          {field('Renewal Date', (
            <input type="date" value={form.renewalDate} onChange={e => set('renewalDate', e.target.value)}
              className={inputCls} style={inputStyle}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {field('Notice Period (days)', (
            <input type="number" min="0"
              value={form.noticePeriodDays}
              onChange={e => set('noticePeriodDays', e.target.value)}
              className={inputCls} style={inputStyle}
            />
          ))}
          {field('Link to PO', (
            <select value={form.linkedPoId} onChange={e => set('linkedPoId', e.target.value)}
              className={inputCls} style={inputStyle} disabled={!form.entityId}>
              <option value="">None</option>
              {poOptions.map(p => <option key={p.id} value={p.id}>{p.poNumber} — {p.title}</option>)}
            </select>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <input type="checkbox" id="autoRenew" checked={form.autoRenew}
            onChange={e => set('autoRenew', e.target.checked)}
            className="rounded" />
          <label htmlFor="autoRenew" className="text-sm" style={{ color: 'var(--ink)' }}>
            Auto-renew at expiry
          </label>
        </div>

        {field('Notes', (
          <textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Internal notes…"
            className={`${inputCls} resize-none`} style={inputStyle}
          />
        ))}

        {error && (
          <div className="px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2 rounded-xl text-sm"
            style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="px-6 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{ background: '#2563eb', color: '#fff' }}>
            {saving ? 'Creating…' : 'Create Contract'}
          </button>
        </div>
      </form>
    </div>
  )
}
