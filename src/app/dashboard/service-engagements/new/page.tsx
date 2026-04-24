'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])

interface EntityOption { id: string; name: string }
interface CatalogueEntry { id: string; name: string; category: string; description: string | null }
interface UserOption { id: string; name: string | null; email: string }

const CATEGORIES = ['BANKING','CUSTODY','FUND_ADMIN','OUTSOURCING','LEGAL','AUDIT','TECHNOLOGY','COMPLIANCE','OTHER']

export default function NewServiceEngagementPage() {
  const user   = useUser()
  const router = useRouter()

  const [entities,   setEntities]   = useState<EntityOption[]>([])
  const [catalogue,  setCatalogue]  = useState<CatalogueEntry[]>([])
  const [users,      setUsers]      = useState<UserOption[]>([])
  const [loadingRef, setLoadingRef] = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const [entityId,          setEntityId]          = useState('')
  const [serviceCatalogueId,setServiceCatalogueId] = useState('')
  const [internalOwner,     setInternalOwner]      = useState('')
  const [department,        setDepartment]         = useState('')
  const [status,            setStatus]             = useState('ACTIVE')
  const [slaStatus,         setSlaStatus]          = useState('NOT_APPLICABLE')
  const [slaTarget,         setSlaTarget]          = useState('')
  const [contractStart,     setContractStart]      = useState('')
  const [contractEnd,       setContractEnd]        = useState('')
  const [notes,             setNotes]              = useState('')
  const [catFilter,         setCatFilter]          = useState('')

  const loadRef = useCallback(async () => {
    try {
      const [entRes, catRes, usrRes] = await Promise.all([
        fetch('/api/entities?pageSize=200'),
        fetch('/api/service-catalogue'),
        fetch('/api/users'),
      ])
      if (entRes.ok) {
        const d = await entRes.json()
        setEntities(d.entities ?? d.data ?? [])
      }
      if (catRes.ok) {
        const d = await catRes.json()
        setCatalogue(d.entries ?? [])
      }
      if (usrRes.ok) {
        const d = await usrRes.json()
        setUsers(d.users ?? d ?? [])
      }
    } catch {
      setError('Could not load reference data.')
    } finally {
      setLoadingRef(false)
    }
  }, [])

  useEffect(() => { loadRef() }, [loadRef])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  const filteredCatalogue = catFilter
    ? catalogue.filter(c => c.category === catFilter)
    : catalogue

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!entityId || !serviceCatalogueId) {
      setError('Entity and service are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/service-engagements', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId, serviceCatalogueId,
          internalOwner: internalOwner || null,
          department:    department    || null,
          status, slaStatus,
          slaTarget:     slaTarget     || null,
          contractStart: contractStart || null,
          contractEnd:   contractEnd   || null,
          notes:         notes         || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to create engagement')
      }
      const { id } = await res.json()
      router.push(`/dashboard/service-engagements/${id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create engagement.')
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <button onClick={() => router.back()} className="text-sm mb-3 hover:underline" style={{ color: 'var(--muted)' }}>
          ← Back
        </button>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>New Service Engagement</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Link a vendor or third party to a service from the catalogue.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loadingRef ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Core selection */}
          <div className="rounded-2xl p-6 space-y-4" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Core</h2>

            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                Entity <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select value={entityId} onChange={e => setEntityId(e.target.value)} required
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                <option value="">Select entity…</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                  Category filter
                </label>
                <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setServiceCatalogueId('') }}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
                  <option value="">All categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                  Service <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <select value={serviceCatalogueId} onChange={e => setServiceCatalogueId(e.target.value)} required
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                  <option value="">Select service…</option>
                  {filteredCatalogue.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING_REVIEW">Pending Review</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="OFFBOARDED">Offboarded</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Department</label>
                <input type="text" value={department} onChange={e => setDepartment(e.target.value)}
                  placeholder="e.g. Treasury"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Internal Owner</label>
              <select value={internalOwner} onChange={e => setInternalOwner(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                <option value="">Unassigned</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Contract */}
          <div className="rounded-2xl p-6 space-y-4" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Contract</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Start Date</label>
                <input type="date" value={contractStart} onChange={e => setContractStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>End Date</label>
                <input type="date" value={contractEnd} onChange={e => setContractEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }} />
              </div>
            </div>
          </div>

          {/* SLA */}
          <div className="rounded-2xl p-6 space-y-4" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>SLA</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>SLA Status</label>
                <select value={slaStatus} onChange={e => setSlaStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                  <option value="NOT_APPLICABLE">N/A</option>
                  <option value="ON_TRACK">On Track</option>
                  <option value="AT_RISK">At Risk</option>
                  <option value="BREACHED">Breached</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>SLA Target</label>
                <input type="text" value={slaTarget} onChange={e => setSlaTarget(e.target.value)}
                  placeholder="e.g. 99.9% uptime"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-2xl p-6" style={{ border: '1px solid var(--border)' }}>
            <label className="text-xs font-medium block mb-2" style={{ color: 'var(--muted)' }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="Internal notes…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }} />
          </div>

          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => router.back()}
              className="px-4 py-2 rounded-xl text-sm"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !entityId || !serviceCatalogueId}
              className="px-6 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
              style={{ background: '#2563eb', color: '#fff' }}>
              {saving ? 'Creating…' : 'Create Engagement'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
