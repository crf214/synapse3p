'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const ENTITY_TYPE_LABEL: Record<string, string> = {
  VENDOR:            'Vendor',
  CONTRACTOR:        'Contractor',
  BROKER:            'Broker',
  PLATFORM:          'Platform',
  FUND_SVC_PROVIDER: 'Fund Svc Provider',
  OTHER:             'Other',
}
const ENTITY_TYPES = Object.keys(ENTITY_TYPE_LABEL)

const STEP_TYPE_LABEL: Record<string, string> = {
  INFORMATION:     'Information',
  DOCUMENT:        'Document',
  REVIEW:          'Review',
  APPROVAL:        'Approval',
  EXTERNAL_CHECK:  'External Check',
  PROCESSING_RULE: 'Processing Rule',
  SUB_WORKFLOW:    'Sub-Workflow',
}
const STEP_TYPES = Object.keys(STEP_TYPE_LABEL)

const OWNER_ROLES = [
  'ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AP_CLERK', 'AUDITOR',
]

const RULE_FIELD_OPTIONS = [
  { value: 'entity.entityType',     label: 'Entity Type'      },
  { value: 'entity.legalStructure', label: 'Legal Structure'  },
  { value: 'entity.riskScore',      label: 'Risk Score'       },
  { value: 'entity.jurisdiction',   label: 'Jurisdiction'     },
]

const RULE_OPERATOR_OPTIONS = [
  { value: 'eq',       label: '= equals'       },
  { value: 'neq',      label: '≠ not equals'   },
  { value: 'gt',       label: '> greater than' },
  { value: 'lt',       label: '< less than'    },
  { value: 'gte',      label: '≥ ≥'            },
  { value: 'lte',      label: '≤ ≤'            },
  { value: 'contains', label: '∋ contains'     },
  { value: 'in',       label: '∈ in list'      },
]

interface RuleCondition {
  id:       string
  field:    string
  operator: string
  value:    string
  nextStep: number
}

interface StepDef {
  stepNo:        number
  title:         string
  type:          string
  required:      boolean
  blocksPayment: boolean
  ownerRole:     string
  description:   string
  parallelGroup: number | null
  // PROCESSING_RULE
  rules?:           RuleCondition[]
  defaultNextStep?: number | null
  // SUB_WORKFLOW
  subWorkflowId?:       string | null
  waitForCompletion?:   boolean
}

const WORKFLOW_TYPE_LABEL: Record<string, string> = {
  ENTITY:         'Entity',
  INVOICE:        'Invoice',
  PURCHASE_ORDER: 'Purchase Order',
  OTHER:          'Other',
}

const WORKFLOW_TYPE_COLOR: Record<string, { bg: string; color: string; border: string }> = {
  ENTITY:         { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  INVOICE:        { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  PURCHASE_ORDER: { bg: '#faf5ff', color: '#7c3aed', border: '#e9d5ff' },
  OTHER:          { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' },
}

interface WorkflowSummary {
  id:           string
  name:         string
  workflowType: string
  isActive:     boolean
}

interface Workflow {
  id:           string
  name:         string
  description:  string | null
  workflowType: string
  entityTypes:  string[]
  isActive:     boolean
  steps:        StepDef[]
  _count:       { instances: number }
}

// Assign temp IDs for React keys (not persisted)
type StepRow = StepDef & { _key: string }

let keyCounter = 0
function mkKey() { return `k${++keyCounter}` }
let ruleCounter = 0
function mkRuleId() { return `r${++ruleCounter}` }

// Group consecutive steps by parallelGroup for visual grouping
function groupSteps(steps: StepRow[]): Array<{ group: number | null; rows: StepRow[] }> {
  const groups: Array<{ group: number | null; rows: StepRow[] }> = []
  for (const step of steps) {
    const last = groups[groups.length - 1]
    if (
      last &&
      step.parallelGroup !== null &&
      last.group === step.parallelGroup
    ) {
      last.rows.push(step)
    } else {
      groups.push({ group: step.parallelGroup, rows: [step] })
    }
  }
  return groups
}

export default function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const user     = useUser()
  const router   = useRouter()
  const canWrite = WRITE_ROLES.has(user.role ?? '')

  const [id,          setId]          = useState<string | null>(null)
  const [workflow,    setWorkflow]    = useState<Workflow | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  // Meta editing
  const [name,        setName]        = useState('')
  const [desc,        setDesc]        = useState('')
  const [entityTypes, setEntityTypes] = useState<Set<string>>(new Set())
  const [isActive,    setIsActive]    = useState(true)

  // Steps
  const [steps,       setSteps]       = useState<StepRow[]>([])

  // Available workflows (for SUB_WORKFLOW step type selector)
  const [allWorkflows, setAllWorkflows] = useState<WorkflowSummary[]>([])

  const [saving,   setSaving]   = useState(false)
  const [saveErr,  setSaveErr]  = useState<string | null>(null)
  const [saved,    setSaved]    = useState(false)
  const [showViz,  setShowViz]  = useState(false)

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resolve params
  useEffect(() => {
    params.then(p => setId(p.id))
  }, [params])

  const load = useCallback(async (wfId: string) => {
    setLoading(true)
    try {
      const [wfRes, listRes] = await Promise.all([
        fetch(`/api/onboarding-workflows/${wfId}`),
        fetch('/api/onboarding-workflows'),
      ])
      if (!wfRes.ok) throw new Error()
      const { workflow: wf } = await wfRes.json() as { workflow: Workflow }
      setWorkflow(wf)
      setName(wf.name)
      setDesc(wf.description ?? '')
      setEntityTypes(new Set(wf.entityTypes))
      setIsActive(wf.isActive)
      setSteps((wf.steps ?? []).map(s => ({ ...s, _key: mkKey() })))

      if (listRes.ok) {
        const { workflows } = await listRes.json() as { workflows: WorkflowSummary[] }
        // Exclude self from sub-workflow list
        setAllWorkflows(workflows.filter(w => w.id !== wfId && w.isActive))
      }
    } catch {
      setError('Could not load workflow.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id) load(id)
  }, [id, load])

  function toggleEntityType(t: string) {
    setEntityTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }

  // ── Step mutations ────────────────────────────────────────────
  function addStep() {
    setSteps(prev => [
      ...prev,
      {
        _key:          mkKey(),
        stepNo:        prev.length + 1,
        title:         '',
        type:          'INFORMATION',
        required:      true,
        blocksPayment: false,
        ownerRole:     'FINANCE_MANAGER',
        description:   '',
        parallelGroup: null,
      },
    ])
  }

  function removeStep(key: string) {
    setSteps(prev => {
      const next = prev.filter(s => s._key !== key)
      return next.map((s, i) => ({ ...s, stepNo: i + 1 }))
    })
  }

  function moveStep(key: string, dir: -1 | 1) {
    setSteps(prev => {
      const idx = prev.findIndex(s => s._key === key)
      if (idx < 0) return prev
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      return next.map((s, i) => ({ ...s, stepNo: i + 1 }))
    })
  }

  function updateStep(key: string, field: keyof StepDef, value: unknown) {
    setSteps(prev =>
      prev.map(s => {
        if (s._key !== key) return s
        const updated = { ...s, [field]: value }
        // When switching to an auto step type, clear ownerRole
        if (field === 'type' && (value === 'PROCESSING_RULE' || value === 'SUB_WORKFLOW')) {
          updated.ownerRole = 'SYSTEM'
          if (value === 'PROCESSING_RULE') {
            updated.rules = updated.rules ?? []
            updated.defaultNextStep = updated.defaultNextStep ?? null
          }
          if (value === 'SUB_WORKFLOW') {
            updated.subWorkflowId = updated.subWorkflowId ?? null
            updated.waitForCompletion = updated.waitForCompletion ?? true
          }
        }
        return updated
      })
    )
  }

  function addRule(stepKey: string) {
    setSteps(prev => prev.map(s => {
      if (s._key !== stepKey) return s
      const newRule: RuleCondition = {
        id:       mkRuleId(),
        field:    'entity.entityType',
        operator: 'eq',
        value:    '',
        nextStep: s.stepNo + 1,
      }
      return { ...s, rules: [...(s.rules ?? []), newRule] }
    }))
  }

  function removeRule(stepKey: string, ruleId: string) {
    setSteps(prev => prev.map(s => {
      if (s._key !== stepKey) return s
      return { ...s, rules: (s.rules ?? []).filter(r => r.id !== ruleId) }
    }))
  }

  function updateRule(stepKey: string, ruleId: string, field: keyof RuleCondition, value: unknown) {
    setSteps(prev => prev.map(s => {
      if (s._key !== stepKey) return s
      return {
        ...s,
        rules: (s.rules ?? []).map(r =>
          r.id === ruleId ? { ...r, [field]: value } : r
        ),
      }
    }))
  }

  // ── Save ──────────────────────────────────────────────────────
  async function save() {
    if (!id) return
    if (!name.trim()) { setSaveErr('Workflow name is required.'); return }
    const emptyStep = steps.findIndex(s => !s.title.trim())
    if (emptyStep >= 0) { setSaveErr(`Step ${emptyStep + 1}: title is required.`); return }
    if (steps.length === 0) { setSaveErr('At least one step is required.'); return }

    setSaving(true); setSaveErr(null)
    try {
      const res = await fetch(`/api/onboarding-workflows/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        name.trim(),
          description: desc.trim() || null,
          entityTypes: [...entityTypes],
          isActive,
          steps: steps.map(({ _key, ...s }) => s),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error?.message ?? 'Failed to save')
      setWorkflow(d.workflow)
      setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ── Guard ─────────────────────────────────────────────────────
  if (!['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'].includes(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  if (loading) return <div className="p-8"><p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p></div>
  if (error || !workflow) return (
    <div className="p-8">
      <p className="text-sm mb-3" style={{ color: '#dc2626' }}>{error ?? 'Workflow not found.'}</p>
      <Link href="/dashboard/settings/onboarding-workflows" className="text-sm" style={{ color: '#2563eb' }}>
        ← Back to Workflows
      </Link>
    </div>
  )

  const grouped = groupSteps(steps)

  return (
    <div className="p-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard/settings/onboarding-workflows"
          className="text-xs mb-3 inline-block"
          style={{ color: 'var(--muted)' }}>
          ← Workflows
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>{workflow.name}</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {workflow._count.instances} instance{workflow._count.instances !== 1 ? 's' : ''} started
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && (
              <span className="text-xs font-medium" style={{ color: '#16a34a' }}>Saved</span>
            )}
            {steps.length > 0 && (
              <button type="button" onClick={() => setShowViz(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: '#f8fafc', color: '#475569', border: '1px solid var(--border)', cursor: 'pointer' }}>
                Visualizer
              </button>
            )}
            {canWrite && (
              <button type="button" onClick={save} disabled={saving}
                className="px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>

      {saveErr && (
        <div className="mb-5 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {saveErr}
        </div>
      )}

      {/* ── Workflow metadata ───────────────────────────────────── */}
      <section className="rounded-2xl p-6 mb-6"
        style={{ border: '1px solid var(--border)', background: '#fff' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>Workflow Settings</h2>

        {/* Workflow type — read-only badge */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Type:</span>
          {(() => {
            const c = WORKFLOW_TYPE_COLOR[workflow.workflowType] ?? WORKFLOW_TYPE_COLOR.OTHER
            return (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                {WORKFLOW_TYPE_LABEL[workflow.workflowType] ?? workflow.workflowType}
              </span>
            )
          })()}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
              Name <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              disabled={!canWrite}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}
            />
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={isActive}
                onChange={e => canWrite && setIsActive(e.target.checked)}
                className="w-4 h-4 rounded" />
              <span className="text-sm" style={{ color: 'var(--ink)' }}>Active</span>
            </label>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
            Description <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
          </label>
          <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)}
            disabled={!canWrite}
            className="w-full px-3 py-2 rounded-xl text-sm resize-none outline-none"
            style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}
          />
        </div>

        {workflow.workflowType === 'ENTITY' && (
          <div>
            <label className="text-xs font-medium block mb-2" style={{ color: 'var(--ink)' }}>
              Applies to Entity Types
              <span className="ml-1 font-normal" style={{ color: 'var(--muted)' }}>(leave blank = default for all)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {ENTITY_TYPES.map(t => {
                const on = entityTypes.has(t)
                return (
                  <button key={t} type="button"
                    onClick={() => canWrite && toggleEntityType(t)}
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      background: on ? '#f0fdf4' : 'var(--surface)',
                      color:      on ? '#16a34a' : 'var(--muted)',
                      border:     on ? '1px solid #16a34a' : '1px solid var(--border)',
                      cursor:     canWrite ? 'pointer' : 'default',
                    }}>
                    {ENTITY_TYPE_LABEL[t]}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Steps ───────────────────────────────────────────────── */}
      <section className="rounded-2xl p-6"
        style={{ border: '1px solid var(--border)', background: '#fff' }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Steps</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Steps run in order. Use ∥ for parallel groups, ◇ for decision rules, and ↪ to trigger sub-workflows.
            </p>
          </div>
          {canWrite && (
            <button type="button" onClick={addStep}
              className="px-3 py-1.5 rounded-xl text-xs font-medium"
              style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', cursor: 'pointer' }}>
              + Add Step
            </button>
          )}
        </div>

        {steps.length === 0 ? (
          <div className="text-center py-10" style={{ color: 'var(--muted)' }}>
            <p className="text-sm mb-2">No steps defined.</p>
            {canWrite && (
              <button type="button" onClick={addStep}
                className="text-sm" style={{ color: '#2563eb' }}>
                Add first step →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.map((grp, gi) => {
              const isParallel = grp.group !== null && grp.rows.length > 1
              return (
                <div key={gi}
                  className={isParallel ? 'rounded-2xl p-2 space-y-2' : ''}
                  style={isParallel ? {
                    border:     '1.5px dashed #93c5fd',
                    background: '#eff6ff22',
                  } : {}}>
                  {isParallel && (
                    <div className="px-2 pt-1">
                      <span className="text-xs font-medium" style={{ color: '#2563eb' }}>
                        Parallel Group {grp.group}
                      </span>
                      <span className="text-xs ml-1.5" style={{ color: 'var(--muted)' }}>
                        — these steps run simultaneously
                      </span>
                    </div>
                  )}
                  {grp.rows.map(step => (
                    <StepCard
                      key={step._key}
                      step={step}
                      total={steps.length}
                      canWrite={canWrite}
                      allWorkflows={allWorkflows}
                      onUpdate={(field, val) => updateStep(step._key, field, val)}
                      onMove={dir => moveStep(step._key, dir)}
                      onRemove={() => removeStep(step._key)}
                      onAddRule={() => addRule(step._key)}
                      onRemoveRule={ruleId => removeRule(step._key, ruleId)}
                      onUpdateRule={(ruleId, field, val) => updateRule(step._key, ruleId, field, val)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Sticky save bar for long step lists */}
      {canWrite && steps.length > 3 && (
        <div className="mt-6 flex justify-end gap-3">
          {saved && (
            <span className="text-xs font-medium self-center" style={{ color: '#16a34a' }}>Saved</span>
          )}
          {saveErr && (
            <span className="text-xs self-center" style={{ color: '#dc2626' }}>{saveErr}</span>
          )}
          <button type="button" onClick={save} disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
            style={{ background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Visualizer modal */}
      {showViz && (
        <WorkflowVisualizer
          workflow={workflow}
          steps={steps}
          allWorkflows={allWorkflows}
          onClose={() => setShowViz(false)}
        />
      )}
    </div>
  )
}

// ── StepCard ───────────────────────────────────────────────────────────────────

interface StepCardProps {
  step:           StepRow
  total:          number
  canWrite:       boolean
  allWorkflows:   WorkflowSummary[]
  onUpdate:       (field: keyof StepDef, value: unknown) => void
  onMove:         (dir: -1 | 1) => void
  onRemove:       () => void
  onAddRule:      () => void
  onRemoveRule:   (ruleId: string) => void
  onUpdateRule:   (ruleId: string, field: keyof RuleCondition, value: unknown) => void
}

const STEP_TYPE_ACCENT: Record<string, { bg: string; color: string; border: string }> = {
  PROCESSING_RULE: { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  SUB_WORKFLOW:    { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
}

function StepCard({
  step, total, canWrite, allWorkflows,
  onUpdate, onMove, onRemove, onAddRule, onRemoveRule, onUpdateRule,
}: StepCardProps) {
  const [expanded, setExpanded] = useState(false)
  const isAutoStep = step.type === 'PROCESSING_RULE' || step.type === 'SUB_WORKFLOW'
  const accent = STEP_TYPE_ACCENT[step.type]

  return (
    <div className="rounded-xl" style={{
      border: accent ? `1.5px solid ${accent.border}` : '1px solid var(--border)',
      background: accent ? accent.bg : '#fafafa',
    }}>
      {/* Summary row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Step number */}
        <span className="text-xs font-semibold w-5 text-center shrink-0" style={{ color: 'var(--muted)' }}>
          {step.stepNo}
        </span>

        {/* Decision / sub-workflow icon */}
        {step.type === 'PROCESSING_RULE' && (
          <span className="text-base shrink-0" title="Processing Rule — decision point">◇</span>
        )}
        {step.type === 'SUB_WORKFLOW' && (
          <span className="text-base shrink-0" title="Sub-Workflow trigger">↪</span>
        )}

        {/* Title inline edit */}
        <input
          type="text"
          value={step.title}
          onChange={e => onUpdate('title', e.target.value)}
          disabled={!canWrite}
          placeholder="Step title…"
          className="flex-1 min-w-0 text-sm font-medium bg-transparent outline-none"
          style={{ color: 'var(--ink)', border: 'none' }}
        />

        {/* Type badge */}
        {canWrite ? (
          <select value={step.type} onChange={e => onUpdate('type', e.target.value)}
            className="text-xs rounded-lg px-2 py-1 outline-none"
            style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: '#fff', cursor: 'pointer' }}>
            {STEP_TYPES.map(t => (
              <option key={t} value={t}>{STEP_TYPE_LABEL[t]}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: '#f1f5f9', color: '#64748b' }}>
            {STEP_TYPE_LABEL[step.type] ?? step.type}
          </span>
        )}

        {/* Badges — hide for auto steps */}
        {!isAutoStep && step.required && (
          <span className="text-xs px-2 py-0.5 rounded-full hidden sm:inline-block"
            style={{ background: '#fef9c3', color: '#854d0e' }}>Required</span>
        )}
        {!isAutoStep && step.blocksPayment && (
          <span className="text-xs px-2 py-0.5 rounded-full hidden sm:inline-block"
            style={{ background: '#fef2f2', color: '#dc2626' }}>Blocks Pay</span>
        )}

        {/* Auto-step badges */}
        {step.type === 'PROCESSING_RULE' && (
          <span className="text-xs px-2 py-0.5 rounded-full hidden sm:inline-block"
            style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}>
            {(step.rules ?? []).length} rule{(step.rules ?? []).length !== 1 ? 's' : ''}
          </span>
        )}
        {step.type === 'SUB_WORKFLOW' && step.subWorkflowId && (
          <span className="text-xs px-2 py-0.5 rounded-full hidden sm:inline-block"
            style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
            {allWorkflows.find(w => w.id === step.subWorkflowId)?.name ?? 'Sub-workflow'}
          </span>
        )}

        {/* Parallel group — hide for auto steps */}
        {!isAutoStep && canWrite ? (
          <div className="flex items-center gap-1 shrink-0" title="Parallel group">
            <span className="text-xs font-medium" style={{ color: '#2563eb' }}>∥</span>
            <input
              type="number" min={1}
              value={step.parallelGroup ?? ''}
              onChange={e => onUpdate('parallelGroup', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="—"
              className="text-xs rounded-lg outline-none text-center"
              style={{
                width: 36,
                border: '1px solid var(--border)',
                color: step.parallelGroup !== null ? '#2563eb' : 'var(--muted)',
                background: step.parallelGroup !== null ? '#eff6ff' : '#fff',
                padding: '1px 4px',
              }}
            />
          </div>
        ) : (!isAutoStep && step.parallelGroup !== null) ? (
          <span className="text-xs px-2 py-0.5 rounded-full hidden sm:inline-block"
            style={{ background: '#eff6ff', color: '#2563eb' }}>∥ {step.parallelGroup}</span>
        ) : null}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {canWrite && (
            <>
              <button type="button" onClick={() => onMove(-1)} disabled={step.stepNo === 1}
                className="w-6 h-6 flex items-center justify-center rounded text-xs disabled:opacity-30"
                style={{ color: 'var(--muted)', cursor: 'pointer' }} title="Move up">
                ↑
              </button>
              <button type="button" onClick={() => onMove(1)} disabled={step.stepNo === total}
                className="w-6 h-6 flex items-center justify-center rounded text-xs disabled:opacity-30"
                style={{ color: 'var(--muted)', cursor: 'pointer' }} title="Move down">
                ↓
              </button>
            </>
          )}
          <button type="button" onClick={() => setExpanded(x => !x)}
            className="w-6 h-6 flex items-center justify-center rounded text-xs"
            style={{ color: 'var(--muted)', cursor: 'pointer' }} title="Edit details">
            {expanded ? '▲' : '▼'}
          </button>
          {canWrite && (
            <button type="button" onClick={onRemove}
              className="w-6 h-6 flex items-center justify-center rounded text-xs"
              style={{ color: '#dc2626', cursor: 'pointer' }} title="Remove step">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>

          {/* ── PROCESSING_RULE config ── */}
          {step.type === 'PROCESSING_RULE' && (
            <ProcessingRuleEditor
              step={step}
              canWrite={canWrite}
              onAddRule={onAddRule}
              onRemoveRule={onRemoveRule}
              onUpdateRule={onUpdateRule}
              onUpdateStep={onUpdate}
            />
          )}

          {/* ── SUB_WORKFLOW config ── */}
          {step.type === 'SUB_WORKFLOW' && (
            <SubWorkflowEditor
              step={step}
              canWrite={canWrite}
              allWorkflows={allWorkflows}
              onUpdate={onUpdate}
            />
          )}

          {/* ── Human step config ── */}
          {!isAutoStep && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {/* Owner role */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Owner Role</label>
                  {canWrite ? (
                    <select value={step.ownerRole} onChange={e => onUpdate('ownerRole', e.target.value)}
                      className="w-full text-xs rounded-xl px-2 py-1.5 outline-none"
                      style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: '#fff', cursor: 'pointer' }}>
                      {OWNER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--ink)' }}>{step.ownerRole}</span>
                  )}
                </div>

                {/* Flags */}
                <div className="flex flex-col gap-2 justify-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={step.required}
                      onChange={e => canWrite && onUpdate('required', e.target.checked)}
                      className="w-3.5 h-3.5 rounded" />
                    <span className="text-xs" style={{ color: 'var(--ink)' }}>Required</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={step.blocksPayment}
                      onChange={e => canWrite && onUpdate('blocksPayment', e.target.checked)}
                      className="w-3.5 h-3.5 rounded" />
                    <span className="text-xs" style={{ color: 'var(--ink)' }}>Blocks Payment</span>
                  </label>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                  Instructions / Description <span className="font-normal">(optional)</span>
                </label>
                <textarea rows={2} value={step.description}
                  onChange={e => onUpdate('description', e.target.value)}
                  disabled={!canWrite}
                  placeholder="Describe what needs to happen in this step…"
                  className="w-full text-xs rounded-xl px-3 py-2 resize-none outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: canWrite ? '#fff' : 'transparent' }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── ProcessingRuleEditor ───────────────────────────────────────────────────────

interface ProcessingRuleEditorProps {
  step:           StepRow
  canWrite:       boolean
  onAddRule:      () => void
  onRemoveRule:   (ruleId: string) => void
  onUpdateRule:   (ruleId: string, field: keyof RuleCondition, value: unknown) => void
  onUpdateStep:   (field: keyof StepDef, value: unknown) => void
}

function ProcessingRuleEditor({
  step, canWrite, onAddRule, onRemoveRule, onUpdateRule, onUpdateStep,
}: ProcessingRuleEditorProps) {
  const rules = step.rules ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold" style={{ color: '#c2410c' }}>Decision Rules</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Rules are evaluated top-to-bottom. First match wins and routes to the specified step.
          </p>
        </div>
        {canWrite && (
          <button type="button" onClick={onAddRule}
            className="px-2.5 py-1 rounded-lg text-xs font-medium"
            style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', cursor: 'pointer' }}>
            + Add Rule
          </button>
        )}
      </div>

      {rules.length === 0 ? (
        <p className="text-xs py-2" style={{ color: 'var(--muted)' }}>
          No rules defined. Add rules to route to specific steps based on entity data.
        </p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, idx) => (
            <div key={rule.id}
              className="rounded-xl p-3 space-y-2"
              style={{ background: '#fff', border: '1px solid #fed7aa' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold" style={{ color: '#c2410c' }}>Rule {idx + 1}</span>
                {canWrite && (
                  <button type="button" onClick={() => onRemoveRule(rule.id)}
                    className="text-xs" style={{ color: '#dc2626', cursor: 'pointer' }}>
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {/* Field */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Field</label>
                  <select
                    value={rule.field}
                    onChange={e => onUpdateRule(rule.id, 'field', e.target.value)}
                    disabled={!canWrite}
                    className="w-full text-xs rounded-lg px-2 py-1.5 outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: '#fff', cursor: canWrite ? 'pointer' : 'default' }}>
                    {RULE_FIELD_OPTIONS.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
                {/* Operator */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Operator</label>
                  <select
                    value={rule.operator}
                    onChange={e => onUpdateRule(rule.id, 'operator', e.target.value)}
                    disabled={!canWrite}
                    className="w-full text-xs rounded-lg px-2 py-1.5 outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: '#fff', cursor: canWrite ? 'pointer' : 'default' }}>
                    {RULE_OPERATOR_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {/* Value */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Value</label>
                  <input
                    type="text"
                    value={rule.value}
                    onChange={e => onUpdateRule(rule.id, 'value', e.target.value)}
                    disabled={!canWrite}
                    placeholder="e.g. VENDOR"
                    className="w-full text-xs rounded-lg px-2 py-1.5 outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>→ Go to step</span>
                <input
                  type="number" min={1}
                  value={rule.nextStep}
                  onChange={e => onUpdateRule(rule.id, 'nextStep', Number(e.target.value))}
                  disabled={!canWrite}
                  className="text-xs rounded-lg px-2 py-1 outline-none"
                  style={{ width: 60, border: '1px solid var(--border)', color: '#c2410c', fontWeight: 600 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Default next step */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
          Default (no match):
        </span>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>go to step</span>
        <input
          type="number" min={1}
          value={step.defaultNextStep ?? ''}
          onChange={e => onUpdateStep('defaultNextStep', e.target.value === '' ? null : Number(e.target.value))}
          disabled={!canWrite}
          placeholder="next"
          className="text-xs rounded-lg px-2 py-1 outline-none"
          style={{ width: 60, border: '1px solid var(--border)', color: '#475569' }}
        />
        <span className="text-xs" style={{ color: 'var(--muted)' }}>(empty = advance sequentially)</span>
      </div>

      {/* Description */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
          Notes <span className="font-normal">(optional)</span>
        </label>
        <textarea rows={2} value={step.description}
          onChange={e => onUpdateStep('description', e.target.value)}
          disabled={!canWrite}
          placeholder="Describe what this decision point evaluates…"
          className="w-full text-xs rounded-xl px-3 py-2 resize-none outline-none"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: canWrite ? '#fff' : 'transparent' }}
        />
      </div>
    </div>
  )
}

// ── SubWorkflowEditor ──────────────────────────────────────────────────────────

interface SubWorkflowEditorProps {
  step:         StepRow
  canWrite:     boolean
  allWorkflows: WorkflowSummary[]
  onUpdate:     (field: keyof StepDef, value: unknown) => void
}

function SubWorkflowEditor({ step, canWrite, allWorkflows, onUpdate }: SubWorkflowEditorProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold mb-0.5" style={{ color: '#15803d' }}>Sub-Workflow Configuration</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          When this step is reached, the selected workflow is triggered as a child process for the same entity.
        </p>
      </div>

      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
          Target Workflow <span style={{ color: '#dc2626' }}>*</span>
        </label>
        {canWrite ? (
          <select
            value={step.subWorkflowId ?? ''}
            onChange={e => onUpdate('subWorkflowId', e.target.value || null)}
            className="w-full text-xs rounded-xl px-2 py-1.5 outline-none"
            style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: '#fff', cursor: 'pointer' }}>
            <option value="">— select a workflow —</option>
            {allWorkflows.map(w => (
              <option key={w.id} value={w.id}>{w.name} ({WORKFLOW_TYPE_LABEL[w.workflowType] ?? w.workflowType})</option>
            ))}
          </select>
        ) : (
          <span className="text-xs" style={{ color: 'var(--ink)' }}>
            {allWorkflows.find(w => w.id === step.subWorkflowId)?.name ?? step.subWorkflowId ?? '—'}
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox"
          checked={step.waitForCompletion ?? true}
          onChange={e => canWrite && onUpdate('waitForCompletion', e.target.checked)}
          className="w-3.5 h-3.5 rounded" />
        <span className="text-xs" style={{ color: 'var(--ink)' }}>
          Wait for sub-workflow to complete before continuing
        </span>
      </label>
      {(step.waitForCompletion ?? true) && (
        <p className="text-xs ml-5" style={{ color: 'var(--muted)' }}>
          Parent workflow pauses in PENDING_SUB_WORKFLOW state until the child instance completes.
        </p>
      )}

      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
          Notes <span className="font-normal">(optional)</span>
        </label>
        <textarea rows={2} value={step.description}
          onChange={e => onUpdate('description', e.target.value)}
          disabled={!canWrite}
          placeholder="Why is this sub-workflow triggered here?"
          className="w-full text-xs rounded-xl px-3 py-2 resize-none outline-none"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: canWrite ? '#fff' : 'transparent' }}
        />
      </div>
    </div>
  )
}

// ── WorkflowVisualizer ─────────────────────────────────────────────────────────

const VIZ_STEP_COLORS: Record<string, { bg: string; border: string; accent: string; label: string }> = {
  INFORMATION:     { bg: '#f8fafc', border: '#cbd5e1', accent: '#64748b', label: 'Info'       },
  DOCUMENT:        { bg: '#eff6ff', border: '#93c5fd', accent: '#2563eb', label: 'Document'   },
  REVIEW:          { bg: '#fefce8', border: '#fde047', accent: '#a16207', label: 'Review'     },
  APPROVAL:        { bg: '#f0fdf4', border: '#86efac', accent: '#15803d', label: 'Approval'   },
  EXTERNAL_CHECK:  { bg: '#faf5ff', border: '#c4b5fd', accent: '#7c3aed', label: 'External'   },
  PROCESSING_RULE: { bg: '#fff7ed', border: '#fed7aa', accent: '#c2410c', label: 'Decision'   },
  SUB_WORKFLOW:    { bg: '#f0fdf4', border: '#6ee7b7', accent: '#059669', label: 'Sub-Flow'   },
}

const LANE_H  = 130
const COL_W   = 196
const ARR_W   = 52
const LABEL_W = 148
const NODE_D  = 46

interface VizProps {
  workflow:     Workflow
  steps:        StepRow[]
  allWorkflows: WorkflowSummary[]
  onClose:      () => void
}

function WorkflowVisualizer({ workflow, steps, allWorkflows, onClose }: VizProps) {
  const stages: StepDef[][] = []
  for (const step of steps) {
    const last = stages[stages.length - 1]
    if (step.parallelGroup !== null && last?.length && last[0].parallelGroup === step.parallelGroup) {
      last.push(step)
    } else {
      stages.push([{ ...step }])
    }
  }

  const roles: string[] = []
  for (const step of steps) {
    const role = step.type === 'PROCESSING_RULE' || step.type === 'SUB_WORKFLOW' ? 'SYSTEM' : step.ownerRole
    if (!roles.includes(role)) roles.push(role)
  }

  const totalH = Math.max(roles.length, 1) * LANE_H

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        position: 'absolute', inset: 24,
        background: '#f1f5f9',
        borderRadius: 20,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 32px 64px rgba(0,0,0,0.45)',
      }}>
        {/* Header */}
        <div style={{
          flexShrink: 0, background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{workflow.name}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {steps.length} step{steps.length !== 1 ? 's' : ''} &middot; {stages.length} stage{stages.length !== 1 ? 's' : ''} &middot; {roles.length} role{roles.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{
            padding: '8px 18px', borderRadius: 12,
            border: '1px solid #e2e8f0', background: '#fff',
            color: '#475569', fontSize: 14, fontWeight: 500, cursor: 'pointer',
          }}>
            Close
          </button>
        </div>

        {/* Chart */}
        <div style={{ flex: 1, overflow: 'auto', padding: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'flex-start', minWidth: 'max-content' }}>

            {/* Swim lane labels */}
            <div style={{ width: LABEL_W, flexShrink: 0 }}>
              {roles.map((role, ri) => (
                <div key={role} style={{
                  height: LANE_H,
                  display: 'flex', alignItems: 'center',
                  paddingRight: 14,
                  borderBottom: ri < roles.length - 1 ? '1px dashed #cbd5e1' : 'none',
                }}>
                  <div style={{
                    width: '100%', textAlign: 'right',
                    background: role === 'SYSTEM' ? '#fff7ed' : '#e2e8f0',
                    borderRadius: 8,
                    padding: '4px 10px',
                    fontSize: 11, fontWeight: 600,
                    color: role === 'SYSTEM' ? '#c2410c' : '#475569',
                    wordBreak: 'break-word',
                  }}>
                    {role}
                  </div>
                </div>
              ))}
            </div>

            {/* Flow area */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>

              {/* START */}
              <TerminalNode label="START" totalH={totalH} />
              <FlowArrow totalH={totalH} />

              {/* Stages */}
              {stages.map((stage, si) => (
                <div key={si} style={{ display: 'flex', alignItems: 'stretch' }}>
                  <div style={{
                    width: COL_W, flexShrink: 0,
                    ...(stage.length > 1 ? {
                      background: 'rgba(37,99,235,0.03)',
                      borderRadius: 12,
                      outline: '2px dashed #93c5fd',
                      outlineOffset: -4,
                    } : {}),
                  }}>
                    {roles.map((role, ri) => {
                      const step = stage.find(s => {
                        const stepRole = s.type === 'PROCESSING_RULE' || s.type === 'SUB_WORKFLOW' ? 'SYSTEM' : s.ownerRole
                        return stepRole === role
                      })
                      return (
                        <div key={role} style={{
                          height: LANE_H,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          borderBottom: ri < roles.length - 1 ? '1px dashed #cbd5e1' : 'none',
                        }}>
                          {step
                            ? (step.type === 'PROCESSING_RULE'
                                ? <VizDecisionNode step={step} />
                                : step.type === 'SUB_WORKFLOW'
                                  ? <VizSubWorkflowNode step={step} allWorkflows={allWorkflows} />
                                  : <VizStepNode step={step} />)
                            : <div style={{ width: 1, height: 40, background: '#e2e8f0' }} />
                          }
                        </div>
                      )
                    })}
                  </div>
                  <FlowArrow totalH={totalH} />
                </div>
              ))}

              {/* END */}
              <TerminalNode label="END" totalH={totalH} />
            </div>
          </div>

          {/* Legend */}
          <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(VIZ_STEP_COLORS).map(([type, c]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: type === 'PROCESSING_RULE' ? 2 : 3, background: c.bg, border: `1.5px solid ${c.border}`, transform: type === 'PROCESSING_RULE' ? 'rotate(45deg)' : 'none' }} />
                <span style={{ fontSize: 11, color: '#64748b' }}>{c.label}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 28, height: 12, borderRadius: 3, border: '2px dashed #93c5fd', background: 'rgba(37,99,235,0.04)' }} />
              <span style={{ fontSize: 11, color: '#64748b' }}>Parallel stage</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TerminalNode({ label, totalH }: { label: string; totalH: number }) {
  return (
    <div style={{ width: NODE_D + 16, flexShrink: 0, height: totalH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: NODE_D, height: NODE_D, borderRadius: '50%',
        background: '#1e293b', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
      }}>
        {label}
      </div>
    </div>
  )
}

function FlowArrow({ totalH }: { totalH: number }) {
  return (
    <div style={{ width: ARR_W, flexShrink: 0, height: totalH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: ARR_W - 10, height: 2, background: '#94a3b8' }} />
        <div style={{
          width: 0, height: 0,
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: '9px solid #94a3b8',
        }} />
      </div>
    </div>
  )
}

function VizStepNode({ step }: { step: StepDef }) {
  const c = VIZ_STEP_COLORS[step.type] ?? VIZ_STEP_COLORS.INFORMATION
  return (
    <div style={{
      width: COL_W - 20,
      padding: '10px 12px',
      borderRadius: 12,
      border: `1.5px solid ${c.border}`,
      background: c.bg,
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: c.accent, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {c.label}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', lineHeight: 1.35, marginBottom: 6 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: step.required || step.blocksPayment ? 6 : 0 }}>
        {step.ownerRole}
      </div>
      {(step.required || step.blocksPayment) && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {step.required && (
            <span style={{ fontSize: 9, fontWeight: 600, background: '#fef9c3', color: '#a16207', padding: '1px 6px', borderRadius: 20 }}>
              Required
            </span>
          )}
          {step.blocksPayment && (
            <span style={{ fontSize: 9, fontWeight: 600, background: '#fef2f2', color: '#dc2626', padding: '1px 6px', borderRadius: 20 }}>
              Blocks Pay
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function VizDecisionNode({ step }: { step: StepDef }) {
  const rules = step.rules ?? []
  return (
    <div style={{
      width: COL_W - 24,
      padding: '10px 12px',
      borderRadius: 8,
      border: '2px solid #fed7aa',
      background: '#fff7ed',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      position: 'relative',
    }}>
      {/* Diamond icon */}
      <div style={{ fontSize: 14, marginBottom: 4, color: '#c2410c' }}>◇</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#c2410c', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Decision
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', lineHeight: 1.35, marginBottom: 4 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 10, color: '#92400e' }}>
        {rules.length} rule{rules.length !== 1 ? 's' : ''}
        {step.defaultNextStep ? ` → default: step ${step.defaultNextStep}` : ''}
      </div>
      {rules.slice(0, 2).map((r, i) => (
        <div key={i} style={{ fontSize: 9, color: '#78350f', marginTop: 2 }}>
          {r.field.replace('entity.', '')} {r.operator} {r.value} → step {r.nextStep}
        </div>
      ))}
      {rules.length > 2 && (
        <div style={{ fontSize: 9, color: '#78350f', marginTop: 2 }}>
          +{rules.length - 2} more…
        </div>
      )}
    </div>
  )
}

function VizSubWorkflowNode({ step, allWorkflows }: { step: StepDef; allWorkflows: WorkflowSummary[] }) {
  const subWf = allWorkflows.find(w => w.id === step.subWorkflowId)
  return (
    <div style={{
      width: COL_W - 24,
      padding: '10px 12px',
      borderRadius: 12,
      border: '2px solid #6ee7b7',
      background: '#f0fdf4',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
    }}>
      <div style={{ fontSize: 14, marginBottom: 4, color: '#059669' }}>↪</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#059669', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Sub-Flow
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', lineHeight: 1.35, marginBottom: 4 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 10, color: '#065f46' }}>
        {subWf ? subWf.name : step.subWorkflowId ?? 'Not configured'}
      </div>
      <div style={{ fontSize: 9, color: '#6b7280', marginTop: 3 }}>
        {(step.waitForCompletion ?? true) ? 'Waits for completion' : 'Async (non-blocking)'}
      </div>
    </div>
  )
}
