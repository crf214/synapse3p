'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

interface Entity   { id: string; name: string; slug: string }
interface Contract { id: string; contractNo: string; type: string; endDate: string | null }

interface LineItem {
  description: string
  quantity:    number
  unitPrice:   number
  taxRate:     number
  glCode:      string
  costCentre:  string
}

function emptyLine(): LineItem {
  return { description: '', quantity: 1, unitPrice: 0, taxRate: 0, glCode: '', costCentre: '' }
}

function lineTotal(item: LineItem): number {
  return item.quantity * item.unitPrice * (1 + item.taxRate)
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewPurchaseOrderPage() {
  const { role } = useUser()
  const router   = useRouter()

  const [entities,  setEntities]  = useState<Entity[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])

  // Form state
  const [entityId,    setEntityId]    = useState('')
  const [contractId,  setContractId]  = useState('')
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [type,        setType]        = useState<'FIXED' | 'OPEN' | 'BLANKET'>('FIXED')
  const [currency,    setCurrency]    = useState('USD')
  const [spendCat,    setSpendCat]    = useState('')
  const [department,  setDepartment]  = useState('')
  const [costCentre,  setCostCentre]  = useState('')
  const [glCode,      setGlCode]      = useState('')
  const [validFrom,   setValidFrom]   = useState('')
  const [validTo,     setValidTo]     = useState('')
  const [reqGR,       setReqGR]       = useState(false)
  const [reqContract, setReqContract] = useState(false)
  const [notes,       setNotes]       = useState('')
  const [lineItems,   setLineItems]   = useState<LineItem[]>([emptyLine()])

  const [saving,    setSaving]    = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Load entities
  useEffect(() => {
    fetch('/api/entities?limit=100')
      .then(r => r.json())
      .then((j: { entities?: Entity[] }) => setEntities(j.entities ?? []))
      .catch(() => {})
  }, [])

  // Load contracts when entity changes
  const loadContracts = useCallback(async (eid: string) => {
    if (!eid) { setContracts([]); return }
    try {
      const res  = await fetch(`/api/purchase-orders/contracts?entityId=${eid}`)
      const json = await res.json() as { contracts?: Contract[] }
      setContracts(json.contracts ?? [])
    } catch { setContracts([]) }
  }, [])

  useEffect(() => { void loadContracts(entityId) }, [entityId, loadContracts])

  const grandTotal = lineItems.reduce((s, item) => s + lineTotal(item), 0)

  function updateLine(i: number, field: keyof LineItem, value: string | number) {
    setLineItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item))
  }

  function addLine() { setLineItems(prev => [...prev, emptyLine()]) }

  function removeLine(i: number) {
    setLineItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)
  }

  async function buildPayload() {
    return {
      entityId, title, description: description || undefined, type, currency,
      spendCategory: spendCat || undefined, department: department || undefined,
      costCentre: costCentre || undefined, glCode: glCode || undefined,
      validFrom: validFrom || undefined, validTo: validTo || undefined,
      requiresGoodsReceipt: reqGR, requiresContract: reqContract,
      notes: notes || undefined,
      contractId: contractId || undefined,
      lineItems: lineItems.map(item => ({
        description: item.description,
        quantity:    item.quantity,
        unitPrice:   item.unitPrice,
        taxRate:     item.taxRate,
        glCode:      item.glCode || undefined,
        costCentre:  item.costCentre || undefined,
      })),
    }
  }

  async function saveDraft() {
    setSaving(true); setError(null)
    try {
      const res  = await fetch('/api/purchase-orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(await buildPayload()),
      })
      const json = await res.json() as { purchaseOrder?: { id: string }; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to create PO')
      router.push(`/dashboard/purchase-orders/${json.purchaseOrder!.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function saveAndSubmit() {
    setSubmitting(true); setError(null)
    try {
      // Create draft first
      const res  = await fetch('/api/purchase-orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(await buildPayload()),
      })
      const json = await res.json() as { purchaseOrder?: { id: string }; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to create PO')

      const poId = json.purchaseOrder!.id

      // Submit immediately
      const res2  = await fetch(`/api/purchase-orders/${poId}/submit`, { method: 'POST' })
      const json2 = await res2.json() as { error?: { message: string } }
      if (!res2.ok) throw new Error(json2.error?.message ?? 'Failed to submit PO')

      router.push(`/dashboard/purchase-orders/${poId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!role || !ALLOWED_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/dashboard/purchase-orders')}
          className="text-sm" style={{ color: 'var(--muted)' }}>← Purchase Orders</button>
        <span style={{ color: 'var(--muted)' }}>/</span>
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>New Purchase Order</span>
      </div>

      <h1 className="text-2xl font-semibold mb-8" style={{ color: 'var(--ink)' }}>Create Purchase Order</h1>

      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* --- SECTION 1: Header fields --- */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-4 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Header
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {/* Vendor / Entity */}
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
              Vendor / Entity <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select value={entityId} onChange={e => { setEntityId(e.target.value); setContractId('') }}
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
              <option value="">Select vendor…</option>
              {entities.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
              Title <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Annual software licences"
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>

          {/* Description */}
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={2} placeholder="Optional description"
              className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>PO Type</label>
            <select value={type} onChange={e => setType(e.target.value as typeof type)}
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
              <option value="FIXED">Fixed</option>
              <option value="OPEN">Open</option>
              <option value="BLANKET">Blanket</option>
            </select>
          </div>

          {/* Currency */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
              {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Contract linkage */}
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
              Link to Contract (optional)
            </label>
            <select value={contractId} onChange={e => setContractId(e.target.value)}
              disabled={!entityId}
              className="w-full text-sm px-3 py-2 rounded-lg border disabled:opacity-50"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
              <option value="">{entityId ? 'No contract' : 'Select a vendor first'}</option>
              {contracts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.contractNo} ({c.type}){c.endDate ? ` · expires ${new Date(c.endDate).toLocaleDateString()}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Spend Category */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Spend Category</label>
            <input value={spendCat} onChange={e => setSpendCat(e.target.value)}
              placeholder="e.g. Software, Services"
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>

          {/* Department */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Department</label>
            <input value={department} onChange={e => setDepartment(e.target.value)}
              placeholder="e.g. Engineering, Finance"
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>

          {/* Cost Centre */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Cost Centre</label>
            <input value={costCentre} onChange={e => setCostCentre(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>

          {/* GL Code */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>GL Code</label>
            <input value={glCode} onChange={e => setGlCode(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>

          {/* Valid From / To */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Valid From</label>
            <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Valid To</label>
            <input type="date" value={validTo} onChange={e => setValidTo(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>

          {/* Flags */}
          <div className="col-span-2 flex gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" checked={reqGR} onChange={e => setReqGR(e.target.checked)} />
              Requires goods receipt
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" checked={reqContract} onChange={e => setReqContract(e.target.checked)} />
              Requires contract
            </label>
          </div>

          {/* Notes */}
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="Internal notes"
              className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </div>
        </div>
      </section>

      {/* --- SECTION 2: Line Items --- */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Line Items
          </h2>
          <button onClick={addLine}
            className="text-xs px-3 py-1.5 rounded-lg border font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
            + Add Line
          </button>
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                {['Description', 'Qty', 'Unit Price', 'Tax %', 'GL Code', 'Total', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-medium"
                    style={{ color: 'var(--muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, i) => (
                <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                  <td className="px-3 py-2">
                    <input value={item.description}
                      onChange={e => updateLine(i, 'description', e.target.value)}
                      placeholder="Description"
                      className="w-full text-sm bg-transparent outline-none"
                      style={{ color: 'var(--ink)' }} />
                  </td>
                  <td className="px-3 py-2 w-20">
                    <input type="number" min="0" step="0.01" value={item.quantity}
                      onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-full text-sm bg-transparent outline-none text-right"
                      style={{ color: 'var(--ink)' }} />
                  </td>
                  <td className="px-3 py-2 w-28">
                    <input type="number" min="0" step="0.01" value={item.unitPrice}
                      onChange={e => updateLine(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                      className="w-full text-sm bg-transparent outline-none text-right"
                      style={{ color: 'var(--ink)' }} />
                  </td>
                  <td className="px-3 py-2 w-20">
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="100" step="0.1"
                        value={Math.round(item.taxRate * 100 * 10) / 10}
                        onChange={e => updateLine(i, 'taxRate', (parseFloat(e.target.value) || 0) / 100)}
                        className="w-full text-sm bg-transparent outline-none text-right"
                        style={{ color: 'var(--ink)' }} />
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 w-24">
                    <input value={item.glCode}
                      onChange={e => updateLine(i, 'glCode', e.target.value)}
                      placeholder="GL"
                      className="w-full text-sm bg-transparent outline-none"
                      style={{ color: 'var(--ink)' }} />
                  </td>
                  <td className="px-3 py-2 w-28 text-right font-medium text-xs" style={{ color: 'var(--ink)' }}>
                    {fmt(lineTotal(item), currency)}
                  </td>
                  <td className="px-3 py-2 w-8">
                    <button onClick={() => removeLine(i)}
                      className="text-xs opacity-40 hover:opacity-100"
                      style={{ color: '#dc2626' }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                <td colSpan={5} className="px-3 py-2.5 text-xs font-medium text-right"
                  style={{ color: 'var(--muted)' }}>
                  Grand Total
                </td>
                <td className="px-3 py-2.5 font-semibold text-right" style={{ color: 'var(--ink)' }}>
                  {fmt(grandTotal, currency)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* --- Actions --- */}
      <div className="flex items-center gap-3">
        <button onClick={saveDraft} disabled={saving || submitting}
          className="px-4 py-2 rounded-lg text-sm font-medium border disabled:opacity-40"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button onClick={saveAndSubmit} disabled={saving || submitting || !entityId || !title}
          className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
          style={{ background: '#2563eb', color: '#fff' }}>
          {submitting ? 'Submitting…' : 'Save & Submit for Approval'}
        </button>
        <button onClick={() => router.push('/dashboard/purchase-orders')}
          className="text-sm" style={{ color: 'var(--muted)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
