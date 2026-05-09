'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

// ── Workflow types ────────────────────────────────────────────────────────────

type WorkflowType = 'ENTITY' | 'INVOICE' | 'PURCHASE_ORDER' | 'OTHER'

const WORKFLOW_TYPE_LABEL: Record<WorkflowType, string> = {
  ENTITY:         'Entity',
  INVOICE:        'Invoice',
  PURCHASE_ORDER: 'Purchase Order',
  OTHER:          'Other',
}

const WORKFLOW_TYPE_DESC: Record<WorkflowType, string> = {
  ENTITY:         'Onboarding, offboarding, reviews, and renewals for third-party entities.',
  INVOICE:        'Processing, approval, and exception workflows for invoices.',
  PURCHASE_ORDER: 'Creation, amendment, and cancellation workflows for purchase orders.',
  OTHER:          'General-purpose workflows not tied to a specific object type.',
}

const WORKFLOW_TYPE_COLOR: Record<WorkflowType, { bg: string; color: string; border: string }> = {
  ENTITY:         { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  INVOICE:        { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  PURCHASE_ORDER: { bg: '#fff7ed', color: '#ea580c', border: '#fed7aa' },
  OTHER:          { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' },
}

const WORKFLOW_TYPES: WorkflowType[] = ['ENTITY', 'INVOICE', 'PURCHASE_ORDER', 'OTHER']

// Suggested names per type shown in the "new" modal
const SUGGESTED_NAMES: Record<WorkflowType, string[]> = {
  ENTITY:         ['New', 'Renew', 'Offboard', 'Renegotiate Contract', 'SLA Review'],
  INVOICE:        ['Standard Approval', 'Dispute Resolution', 'Exception Approval'],
  PURCHASE_ORDER: ['New PO', 'Amendment', 'Cancellation'],
  OTHER:          [],
}

// ── Entity types (only relevant for ENTITY workflows) ─────────────────────────

const ENTITY_TYPE_LABEL: Record<string, string> = {
  VENDOR:            'Vendor',
  CONTRACTOR:        'Contractor',
  BROKER:            'Broker',
  PLATFORM:          'Platform',
  FUND_SVC_PROVIDER: 'Fund Svc Provider',
  OTHER:             'Other',
}
const ENTITY_TYPES = Object.keys(ENTITY_TYPE_LABEL)

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowSummary {
  id:           string
  name:         string
  description:  string | null
  workflowType: WorkflowType
  entityTypes:  string[]
  isActive:     boolean
  steps:        unknown[]
  createdAt:    string
  _count:       { instances: number }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const user     = useUser()
  const router   = useRouter()
  const canWrite = WRITE_ROLES.has(user.role ?? '')

  const [workflows,  setWorkflows]  = useState<WorkflowSummary[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [showNew,    setShowNew]    = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<WorkflowType>>(new Set(WORKFLOW_TYPES))

  // New workflow form state
  const [newType,    setNewType]    = useState<WorkflowType>('ENTITY')
  const [newName,    setNewName]    = useState('')
  const [newDesc,    setNewDesc]    = useState('')
  const [newEntTypes,setNewEntTypes]= useState<Set<string>>(new Set())
  const [creating,   setCreating]   = useState(false)
  const [createErr,  setCreateErr]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/onboarding-workflows')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setWorkflows(d.workflows)
    } catch {
      setError('Could not load workflows.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggleGroup(t: WorkflowType) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }

  function toggleEntType(t: string) {
    setNewEntTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }

  function resetNewForm() {
    setNewName(''); setNewDesc(''); setNewEntTypes(new Set()); setCreateErr(null)
  }

  async function createWorkflow() {
    if (!newName.trim()) { setCreateErr('Name is required.'); return }
    setCreating(true); setCreateErr(null)
    try {
      const res = await apiClient('/api/onboarding-workflows', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         newName.trim(),
          description:  newDesc.trim() || null,
          workflowType: newType,
          entityTypes:  newType === 'ENTITY' ? [...newEntTypes] : [],
          steps: [{
            stepNo: 1, title: 'Step 1', type: 'INFORMATION',
            required: true, blocksPayment: false,
            ownerRole: 'FINANCE_MANAGER', description: '', parallelGroup: null,
          }],
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error?.message ?? 'Failed')
      setShowNew(false)
      resetNewForm()
      router.push(`/dashboard/settings/onboarding-workflows/${d.workflow.id}`)
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : 'Failed')
      setCreating(false)
    }
  }

  async function toggleActive(w: WorkflowSummary) {
    await apiClient(`/api/onboarding-workflows/${w.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !w.isActive }),
    })
    await load()
  }

  async function remove(w: WorkflowSummary) {
    if (!confirm(`Remove "${w.name}"? If it has existing instances it will be deactivated instead.`)) return
    await apiClient(`/api/onboarding-workflows/${w.id}`, { method: 'DELETE' })
    await load()
  }

  if (!['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'].includes(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  // Group workflows by type
  const grouped = Object.fromEntries(
    WORKFLOW_TYPES.map(t => [t, workflows.filter(w => w.workflowType === t)])
  ) as Record<WorkflowType, WorkflowSummary[]>

  return (
    <div className="p-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Workflows</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Define step-by-step processes by type. Each workflow type groups related processes together.
          </p>
        </div>
        {canWrite && (
          <button type="button" onClick={() => setShowNew(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
            + New Workflow
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <div className="space-y-4">
          {WORKFLOW_TYPES.map(type => {
            const col   = WORKFLOW_TYPE_COLOR[type]
            const items = grouped[type]
            const open  = openGroups.has(type)

            return (
              <div key={type} className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--border)' }}>

                {/* Group header */}
                <button type="button"
                  onClick={() => toggleGroup(type)}
                  className="w-full flex items-center gap-3 px-5 py-4"
                  style={{ background: '#fafafa', cursor: 'pointer', borderBottom: open ? '1px solid var(--border)' : 'none' }}>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: col.bg, color: col.color, border: `1px solid ${col.border}` }}>
                    {WORKFLOW_TYPE_LABEL[type]}
                  </span>
                  <div className="flex-1 text-left">
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{WORKFLOW_TYPE_DESC[type]}</p>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {items.length} workflow{items.length !== 1 ? 's' : ''}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2563eb', opacity: open ? 1 : 0.65, marginLeft: 4 }}>
                    {open ? '▼' : '▶'}
                  </span>
                </button>

                {/* Workflow rows */}
                {open && (
                  <div className="divide-y" style={{ background: '#fff' }}>
                    {items.length === 0 ? (
                      <div className="px-5 py-4 text-sm" style={{ color: 'var(--muted)' }}>
                        No workflows defined.
                        {canWrite && (
                          <button type="button"
                            onClick={() => { setNewType(type); setShowNew(true) }}
                            className="ml-2 text-sm" style={{ color: '#2563eb' }}>
                            Create one →
                          </button>
                        )}
                      </div>
                    ) : (
                      items.map(w => (
                        <div key={w.id} className="flex items-start gap-4 px-5 py-4"
                          style={{ opacity: w.isActive ? 1 : 0.65 }}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Link href={`/dashboard/settings/onboarding-workflows/${w.id}`}
                                className="text-sm font-semibold hover:underline"
                                style={{ color: 'var(--ink)' }}>
                                {w.name}
                              </Link>
                              {!w.isActive && (
                                <span className="text-xs px-2 py-0.5 rounded-full"
                                  style={{ background: '#f1f5f9', color: '#94a3b8' }}>
                                  Inactive
                                </span>
                              )}
                            </div>
                            {w.description && (
                              <p className="text-xs mb-1.5" style={{ color: 'var(--muted)' }}>{w.description}</p>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {type === 'ENTITY' && (
                                w.entityTypes.length === 0 ? (
                                  <span className="text-xs px-2 py-0.5 rounded-full"
                                    style={{ background: '#eff6ff', color: '#2563eb' }}>
                                    All entity types
                                  </span>
                                ) : w.entityTypes.map(t => (
                                  <span key={t} className="text-xs px-2 py-0.5 rounded-full font-medium"
                                    style={{ background: '#f0fdf4', color: '#16a34a' }}>
                                    {ENTITY_TYPE_LABEL[t] ?? t}
                                  </span>
                                ))
                              )}
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                                {w.steps.length} step{w.steps.length !== 1 ? 's' : ''} · {w._count.instances} instance{w._count.instances !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>

                          <div className="flex gap-1.5 shrink-0">
                            <Link href={`/dashboard/settings/onboarding-workflows/${w.id}`}
                              className="px-3 py-1.5 rounded-xl text-xs font-medium"
                              style={{ background: '#eff6ff', color: '#2563eb', textDecoration: 'none' }}>
                              Edit Steps
                            </Link>
                            {canWrite && (
                              <>
                                <button type="button" onClick={() => toggleActive(w)}
                                  className="px-3 py-1.5 rounded-xl text-xs"
                                  style={{ border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
                                  {w.isActive ? 'Deactivate' : 'Activate'}
                                </button>
                                <button type="button" onClick={() => remove(w)}
                                  className="px-3 py-1.5 rounded-xl text-xs"
                                  style={{ background: '#fef2f2', color: '#dc2626', border: 'none', cursor: 'pointer' }}>
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── New workflow modal ── */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-lg rounded-2xl shadow-xl"
            style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>New Workflow</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                You can add and reorder steps after creation.
              </p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {createErr && (
                <div className="px-4 py-3 rounded-xl text-sm"
                  style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                  {createErr}
                </div>
              )}

              {/* Workflow type selector */}
              <div>
                <label className="text-xs font-medium block mb-2" style={{ color: 'var(--ink)' }}>
                  Workflow Type <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {WORKFLOW_TYPES.map(t => {
                    const col = WORKFLOW_TYPE_COLOR[t]
                    const on  = newType === t
                    return (
                      <button key={t} type="button" onClick={() => setNewType(t)}
                        className="px-3 py-2.5 rounded-xl text-left text-xs transition-all"
                        style={{
                          background: on ? col.bg : 'var(--surface)',
                          color:      on ? col.color : 'var(--muted)',
                          border:     on ? `2px solid ${col.color}` : '1px solid var(--border)',
                          fontWeight: on ? 600 : 400,
                          cursor:     'pointer',
                        }}>
                        <div className="font-medium">{WORKFLOW_TYPE_LABEL[t]}</div>
                        <div className="text-xs opacity-70 mt-0.5 font-normal leading-tight">
                          {SUGGESTED_NAMES[t].length > 0
                            ? SUGGESTED_NAMES[t].slice(0, 3).join(', ')
                            : 'Custom workflows'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
                  Workflow Name <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder={SUGGESTED_NAMES[newType][0] ? `e.g. ${SUGGESTED_NAMES[newType][0]}` : 'e.g. Custom Workflow'}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}
                />
                {SUGGESTED_NAMES[newType].length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {SUGGESTED_NAMES[newType].map(s => (
                      <button key={s} type="button" onClick={() => setNewName(s)}
                        className="text-xs px-2 py-0.5 rounded-lg"
                        style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
                  Description <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
                </label>
                <textarea rows={2} value={newDesc} onChange={e => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm resize-none outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}
                />
              </div>

              {/* Entity types — only for ENTITY workflows */}
              {newType === 'ENTITY' && (
                <div>
                  <label className="text-xs font-medium block mb-2" style={{ color: 'var(--ink)' }}>
                    Applies to Entity Types
                    <span className="ml-1 font-normal" style={{ color: 'var(--muted)' }}>(leave blank = all)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ENTITY_TYPES.map(t => {
                      const on = newEntTypes.has(t)
                      return (
                        <button key={t} type="button" onClick={() => toggleEntType(t)}
                          className="px-3 py-1 rounded-full text-xs font-medium"
                          style={{
                            background: on ? '#f0fdf4' : 'var(--surface)',
                            color:      on ? '#16a34a' : 'var(--muted)',
                            border:     on ? '1px solid #16a34a' : '1px solid var(--border)',
                            cursor:     'pointer',
                          }}>
                          {ENTITY_TYPE_LABEL[t]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 flex justify-end gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <button type="button"
                onClick={() => { setShowNew(false); resetNewForm() }}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={createWorkflow} disabled={creating}
                className="px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
                {creating ? 'Creating…' : 'Create & Edit Steps'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
