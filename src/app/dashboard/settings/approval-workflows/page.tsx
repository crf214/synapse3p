'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN'])

const ROLE_OPTIONS = [
  { value: 'AP_CLERK',         label: 'AP Clerk'         },
  { value: 'FINANCE_MANAGER',  label: 'Finance Manager'  },
  { value: 'CONTROLLER',       label: 'Controller'       },
  { value: 'CFO',              label: 'CFO'              },
  { value: 'ADMIN',            label: 'Admin'            },
]

interface WorkflowStep { step: number; role: string; label: string }

interface Workflow {
  id:              string
  name:            string
  description:     string | null
  thresholdMin:    number
  thresholdMax:    number | null
  spendCategories: string[]
  departments:     string[]
  steps:           WorkflowStep[]
  isActive:        boolean
}

function emptyStep(n: number): WorkflowStep {
  return { step: n, role: 'FINANCE_MANAGER', label: '' }
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function WorkflowModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Workflow | null
  onSave: (wf: Workflow) => void
  onClose: () => void
}) {
  const [name,        setName]        = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [threshMin,   setThreshMin]   = useState(String(initial?.thresholdMin ?? 0))
  const [threshMax,   setThreshMax]   = useState(initial?.thresholdMax != null ? String(initial.thresholdMax) : '')
  const [spendCats,   setSpendCats]   = useState((initial?.spendCategories ?? []).join(', '))
  const [depts,       setDepts]       = useState((initial?.departments ?? []).join(', '))
  const [steps,       setSteps]       = useState<WorkflowStep[]>(
    initial?.steps?.length ? initial.steps : [emptyStep(1)]
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  function updateStep(i: number, field: keyof WorkflowStep, value: string) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }
  function addStep()       { setSteps(prev => [...prev, emptyStep(prev.length + 1)]) }
  function removeStep(i: number) {
    setSteps(prev => prev.length > 1
      ? prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, step: idx + 1 }))
      : prev
    )
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const payload = {
        name,
        description: description || undefined,
        thresholdMin:    parseFloat(threshMin) || 0,
        thresholdMax:    threshMax ? parseFloat(threshMax) : null,
        spendCategories: spendCats.split(',').map(s => s.trim()).filter(Boolean),
        departments:     depts.split(',').map(s => s.trim()).filter(Boolean),
        steps:           steps.map((s, i) => ({ step: i + 1, role: s.role, label: s.label })),
      }

      const url    = initial ? `/api/approval-workflows/${initial.id}` : '/api/approval-workflows'
      const method = initial ? 'PUT' : 'POST'
      const res    = await apiClient(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const json = await res.json() as { workflow?: Workflow; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Save failed')
      onSave(json.workflow!)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-screen overflow-y-auto"
        style={{ background: 'var(--bg)' }}>
        <div className="p-6 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            {initial ? 'Edit Workflow' : 'New Approval Workflow'}
          </h2>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#dc2626' }}>{error}</div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
              Name <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Standard approval (>$10k)"
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Min Amount</label>
              <input type="number" min="0" value={threshMin} onChange={e => setThreshMin(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Max Amount (blank = no limit)</label>
              <input type="number" min="0" value={threshMax} onChange={e => setThreshMax(e.target.value)}
                placeholder="No limit"
                className="w-full text-sm px-3 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
              Spend Categories (comma-separated, blank = all)
            </label>
            <input value={spendCats} onChange={e => setSpendCats(e.target.value)}
              placeholder="Software, Services, Hardware"
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
              Departments (comma-separated, blank = all)
            </label>
            <input value={depts} onChange={e => setDepts(e.target.value)}
              placeholder="Engineering, Finance"
              className="w-full text-sm px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                Approval Steps <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <button onClick={addStep} className="text-xs px-2 py-1 rounded border"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>+ Step</button>
            </div>
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2 p-3 rounded-lg border"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <span className="text-xs font-medium w-6 text-center flex-shrink-0"
                    style={{ color: 'var(--muted)' }}>{i + 1}</span>
                  <select value={s.role} onChange={e => updateStep(i, 'role', e.target.value)}
                    className="text-xs px-2 py-1.5 rounded border flex-shrink-0"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
                    {ROLE_OPTIONS.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <input value={s.label} onChange={e => updateStep(i, 'label', e.target.value)}
                    placeholder="Step label (e.g. Finance Review)"
                    className="flex-1 text-xs px-2 py-1.5 rounded border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
                  <button onClick={() => removeStep(i)}
                    className="text-xs opacity-40 hover:opacity-100 flex-shrink-0"
                    style={{ color: '#dc2626' }}>×</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t flex gap-3 justify-end" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>Cancel</button>
          <button onClick={save} disabled={saving || !name}
            className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
            style={{ background: '#2563eb', color: '#fff' }}>
            {saving ? 'Saving…' : 'Save Workflow'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ApprovalWorkflowsPage() {
  const { role } = useUser()

  const [workflows,  setWorkflows]  = useState<Workflow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editing,    setEditing]    = useState<Workflow | null>(null)
  const [deleting,   setDeleting]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/approval-workflows')
      .then(r => r.json())
      .then((j: { workflows?: Workflow[] }) => setWorkflows(j.workflows ?? []))
      .catch(() => setError('Failed to load workflows'))
      .finally(() => setLoading(false))
  }, [])

  async function deactivate(id: string) {
    setDeleting(id)
    try {
      await apiClient(`/api/approval-workflows/${id}`, { method: 'DELETE' })
      setWorkflows(prev => prev.map(wf => wf.id === id ? { ...wf, isActive: false } : wf))
    } catch { /* ignore */ }
    finally { setDeleting(null) }
  }

  function onSaved(wf: Workflow) {
    setWorkflows(prev => {
      const i = prev.findIndex(w => w.id === wf.id)
      return i >= 0 ? prev.map(w => w.id === wf.id ? wf : w) : [...prev, wf]
    })
    setModalOpen(false)
    setEditing(null)
  }

  if (!role || !ALLOWED_ROLES.has(role)) {
    return (
      <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>
        Only ADMIN users can manage approval workflows.
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Approval Workflows</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Configure approval chains by amount threshold, spend category, and department.
          </p>
        </div>
        <button onClick={() => { setEditing(null); setModalOpen(true) }}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#2563eb', color: '#fff' }}>
          + New Workflow
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#dc2626' }}>{error}</div>
      )}

      {loading ? (
        <div className="text-sm py-12 text-center" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : workflows.length === 0 ? (
        <div className="text-sm py-12 text-center" style={{ color: 'var(--muted)' }}>
          No workflows configured. Create one to enable PO approval routing.
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map(wf => (
            <div key={wf.id} className="p-5 rounded-xl border"
              style={{
                borderColor: 'var(--border)',
                background:  'var(--surface)',
                opacity: wf.isActive ? 1 : 0.5,
              }}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{wf.name}</h3>
                    {!wf.isActive && (
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb' }}>
                        Inactive
                      </span>
                    )}
                  </div>
                  {wf.description && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{wf.description}</p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => { setEditing(wf); setModalOpen(true) }}
                    className="text-xs px-3 py-1.5 rounded-lg border"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                    Edit
                  </button>
                  {wf.isActive && (
                    <button onClick={() => deactivate(wf.id)} disabled={deleting === wf.id}
                      className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40"
                      style={{ borderColor: '#fca5a5', color: '#dc2626' }}>
                      {deleting === wf.id ? '…' : 'Deactivate'}
                    </button>
                  )}
                </div>
              </div>

              {/* Threshold */}
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="text-xs px-2 py-1 rounded"
                  style={{ background: '#eff6ff', color: '#2563eb' }}>
                  {wf.thresholdMax != null
                    ? `$${wf.thresholdMin.toLocaleString()} – $${wf.thresholdMax.toLocaleString()}`
                    : `$${wf.thresholdMin.toLocaleString()}+`}
                </span>
                {wf.spendCategories.length > 0 && wf.spendCategories.map(c => (
                  <span key={c} className="text-xs px-2 py-1 rounded"
                    style={{ background: '#f5f3ff', color: '#7c3aed' }}>{c}</span>
                ))}
                {wf.departments.length > 0 && wf.departments.map(d => (
                  <span key={d} className="text-xs px-2 py-1 rounded"
                    style={{ background: '#fef3c7', color: '#92400e' }}>{d}</span>
                ))}
              </div>

              {/* Steps */}
              <div className="flex items-center gap-1">
                {(wf.steps ?? []).map((s, i) => (
                  <div key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-xs" style={{ color: 'var(--muted)' }}>→</span>}
                    <span className="text-xs px-2 py-1 rounded"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                      {s.label || s.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <WorkflowModal
          initial={editing}
          onSave={onSaved}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}
    </div>
  )
}
