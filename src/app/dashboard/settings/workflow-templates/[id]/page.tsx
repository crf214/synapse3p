'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER'])

// ─── Types ───────────────────────────────────────────────────────────────────

interface StepDef {
  id:               string
  name:             string
  description:      string | null
  stepType:         string
  executionMode:    string
  onMissingContext: string
  order:            number
  config:           Record<string, unknown>
  nextSteps:        Record<string, unknown>
  dependencies:     unknown[]
}

interface SelectionRule {
  id:           string
  priority:     number
  triggerEvent: string
  conditions:   unknown[]
  isActive:     boolean
}

interface TemplateDetail {
  id:               string
  name:             string
  description:      string | null
  targetObjectType: string
  isActive:         boolean
  isValid:          boolean
  version:          number
  steps:            StepDef[]
  selectionRules:   SelectionRule[]
  _count:           { instances: number }
}

// ─── Style maps ──────────────────────────────────────────────────────────────

const STEP_TYPE_COLORS: Record<string, { color: string; bg: string }> = {
  APPROVAL:         { color: '#2563eb', bg: '#eff6ff' },
  AUTO_RULE:        { color: '#16a34a', bg: '#f0fdf4' },
  CONDITION_BRANCH: { color: '#d97706', bg: '#fffbeb' },
  NOTIFICATION:     { color: '#7c3aed', bg: '#f5f3ff' },
  WAIT_FOR:         { color: '#6b7280', bg: '#f3f4f6' },
  SUB_WORKFLOW:     { color: '#0891b2', bg: '#ecfeff' },
}

const STEP_TYPES   = ['APPROVAL', 'AUTO_RULE', 'CONDITION_BRANCH', 'NOTIFICATION', 'WAIT_FOR', 'SUB_WORKFLOW'] as const
const EXEC_MODES   = ['SYNC', 'ASYNC'] as const
const MISSING_CTXS = ['FAIL', 'WAIT', 'SKIP'] as const
const TRIGGER_EVENTS = ['OBJECT_CREATED', 'OBJECT_UPDATED', 'STATUS_CHANGED', 'MANUAL'] as const

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WorkflowTemplateEditorPage() {
  const { role } = useUser()
  const params   = useParams()
  const router   = useRouter()
  const qc       = useQueryClient()
  const id       = params.id as string

  const qKey = queryKeys.workflowTemplates.detail(id)

  const [tab, setTab] = useState<'steps' | 'rules'>('steps')

  // Header editing
  const [editName,     setEditName]     = useState(false)
  const [editDesc,     setEditDesc]     = useState(false)
  const [nameVal,      setNameVal]      = useState('')
  const [descVal,      setDescVal]      = useState('')
  const [savingHeader, setSavingHeader] = useState(false)

  // Step expansion
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Step reorder
  const [reordering, setReordering] = useState<string | null>(null)

  // Add step modal
  const [showAddStep,    setShowAddStep]    = useState(false)
  const [stepName,       setStepName]       = useState('')
  const [stepType,       setStepType]       = useState<typeof STEP_TYPES[number]>('AUTO_RULE')
  const [stepExecMode,   setStepExecMode]   = useState<typeof EXEC_MODES[number]>('SYNC')
  const [stepMissingCtx, setStepMissingCtx] = useState<typeof MISSING_CTXS[number]>('FAIL')
  const [addingStep,     setAddingStep]     = useState(false)
  const [addStepError,   setAddStepError]   = useState<string | null>(null)

  // Add rule modal
  const [showAddRule,   setShowAddRule]   = useState(false)
  const [rulePriority,  setRulePriority]  = useState(100)
  const [ruleTrigger,   setRuleTrigger]   = useState<typeof TRIGGER_EVENTS[number]>('OBJECT_CREATED')
  const [ruleConditions, setRuleConditions] = useState<Array<{field: string; operator: string; value: string}>>([])
  const [addingRule,    setAddingRule]    = useState(false)
  const [addRuleError,  setAddRuleError]  = useState<string | null>(null)

  // Validate
  const [validating,    setValidating]    = useState(false)
  const [validateResult, setValidateResult] = useState<{ isValid: boolean; errors: string[] } | null>(null)

  const { data: template, isLoading, isError } = useQuery({
    queryKey: qKey,
    queryFn:  async () => {
      const res  = await fetch(`/api/workflow-templates/${id}`)
      const json = await res.json() as { template: TemplateDetail; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      return json.template
    },
  })

  if (!role || !ALLOWED_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }
  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (isError || !template) return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>Failed to load template.</div>

  const canWrite = WRITE_ROLES.has(role)

  // ── Header save ────────────────────────────────────────────────────────────

  async function saveHeader(patch: { name?: string; description?: string; isActive?: boolean }) {
    setSavingHeader(true)
    try {
      const res = await apiClient(`/api/workflow-templates/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Save failed')
      void qc.invalidateQueries({ queryKey: qKey })
      void qc.invalidateQueries({ queryKey: queryKeys.workflowTemplates.list() })
    } catch { /* silent fail — UI refresh still happens */ }
    finally { setSavingHeader(false); setEditName(false); setEditDesc(false) }
  }

  // ── Step operations ────────────────────────────────────────────────────────

  async function addStep() {
    if (!stepName.trim()) return
    setAddingStep(true); setAddStepError(null)
    try {
      const res = await apiClient(`/api/workflow-templates/${id}/steps`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: stepName.trim(), stepType, executionMode: stepExecMode, onMissingContext: stepMissingCtx }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to add step')
      void qc.invalidateQueries({ queryKey: qKey })
      setShowAddStep(false); setStepName('')
    } catch (e) { setAddStepError(e instanceof Error ? e.message : 'Failed') }
    finally { setAddingStep(false) }
  }

  async function moveStep(stepId: string, direction: 'up' | 'down') {
    if (!template) return
    const steps  = [...template.steps].sort((a, b) => a.order - b.order)
    const idx    = steps.findIndex(s => s.id === stepId)
    if (idx < 0) return
    const target = direction === 'up' ? steps[idx - 1] : steps[idx + 1]
    if (!target) return
    setReordering(stepId)
    try {
      await Promise.all([
        apiClient(`/api/workflow-templates/${id}/steps/${stepId}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ order: target.order }),
        }),
        apiClient(`/api/workflow-templates/${id}/steps/${target.id}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ order: steps[idx].order }),
        }),
      ])
      void qc.invalidateQueries({ queryKey: qKey })
    } finally { setReordering(null) }
  }

  async function deleteStep(stepId: string) {
    if (!confirm('Delete this step? This cannot be undone.')) return
    await apiClient(`/api/workflow-templates/${id}/steps/${stepId}`, { method: 'DELETE' })
    void qc.invalidateQueries({ queryKey: qKey })
  }

  // ── Rule operations ────────────────────────────────────────────────────────

  async function addRule() {
    setAddingRule(true); setAddRuleError(null)
    try {
      const res = await apiClient(`/api/workflow-templates/${id}/selection-rules`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ priority: rulePriority, triggerEvent: ruleTrigger, conditions: ruleConditions }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to add rule')
      void qc.invalidateQueries({ queryKey: qKey })
      setShowAddRule(false); setRuleConditions([])
    } catch (e) { setAddRuleError(e instanceof Error ? e.message : 'Failed') }
    finally { setAddingRule(false) }
  }

  async function toggleRule(ruleId: string, isActive: boolean) {
    await apiClient(`/api/workflow-templates/${id}/selection-rules/${ruleId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isActive }),
    })
    void qc.invalidateQueries({ queryKey: qKey })
  }

  async function deleteRule(ruleId: string) {
    if (!confirm('Delete this selection rule?')) return
    await apiClient(`/api/workflow-templates/${id}/selection-rules/${ruleId}`, { method: 'DELETE' })
    void qc.invalidateQueries({ queryKey: qKey })
  }

  // ── Validate ───────────────────────────────────────────────────────────────

  async function validateTemplate() {
    setValidating(true); setValidateResult(null)
    try {
      const res  = await apiClient(`/api/workflow-templates/${id}/validate`, { method: 'POST' })
      const json = await res.json() as { isValid: boolean; errors: string[] }
      setValidateResult(json)
      void qc.invalidateQueries({ queryKey: qKey })
      void qc.invalidateQueries({ queryKey: queryKeys.workflowTemplates.list() })
    } finally { setValidating(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const sortedSteps = [...template.steps].sort((a, b) => a.order - b.order)

  return (
    <div className="p-8 max-w-4xl">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link href="/dashboard/settings/workflow-templates"
          className="text-sm" style={{ color: 'var(--muted)' }}>
          ← Workflow Templates
        </Link>
        <span style={{ color: 'var(--muted)' }}>/</span>
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{template.name}</span>
      </div>

      {/* Header card */}
      <div className="rounded-xl border mb-6 p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            {editName && canWrite ? (
              <div className="flex items-center gap-2">
                <input
                  value={nameVal}
                  onChange={e => setNameVal(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border text-lg font-semibold"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') void saveHeader({ name: nameVal }) }}
                />
                <button onClick={() => void saveHeader({ name: nameVal })} disabled={savingHeader}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
                  style={{ background: '#2563eb', color: '#fff' }}>
                  {savingHeader ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditName(false)}
                  className="text-xs px-3 py-1.5 rounded-lg border"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>{template.name}</h1>
                {canWrite && (
                  <button onClick={() => { setNameVal(template.name); setEditName(true) }}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    Edit
                  </button>
                )}
              </div>
            )}

            {editDesc && canWrite ? (
              <div className="flex items-start gap-2 mt-2">
                <textarea
                  value={descVal}
                  onChange={e => setDescVal(e.target.value)}
                  rows={2}
                  className="flex-1 px-3 py-1.5 rounded-lg border text-sm resize-none"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  autoFocus
                />
                <div className="flex gap-1 flex-col">
                  <button onClick={() => void saveHeader({ description: descVal })} disabled={savingHeader}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
                    style={{ background: '#2563eb', color: '#fff' }}>
                    {savingHeader ? '…' : 'Save'}
                  </button>
                  <button onClick={() => setEditDesc(false)}
                    className="text-xs px-3 py-1.5 rounded-lg border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {template.description || <em>No description.</em>}
                </p>
                {canWrite && (
                  <button onClick={() => { setDescVal(template.description ?? ''); setEditDesc(true) }}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Validate button */}
          {canWrite && (
            <button onClick={validateTemplate} disabled={validating}
              className="flex-shrink-0 text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
              style={{ background: template.isValid ? '#f0fdf4' : '#fffbeb', color: template.isValid ? '#16a34a' : '#d97706', border: `1px solid ${template.isValid ? '#16a34a30' : '#d9770630'}` }}>
              {validating ? 'Validating…' : template.isValid ? '✓ Valid' : 'Validate Template'}
            </button>
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: '#f1f5f9', color: '#475569' }}>
            {template.targetObjectType.replace('_', ' ')}
          </span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>v{template.version}</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {template._count.instances} instance{template._count.instances !== 1 ? 's' : ''}
          </span>

          {/* isActive toggle */}
          {canWrite ? (
            <button
              onClick={() => {
                if (template.isActive) {
                  void saveHeader({ isActive: false })
                } else if (confirm('Activating this template will make it available for new workflow instances. Ensure it is valid first. Continue?')) {
                  void saveHeader({ isActive: true })
                }
              }}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{
                background: template.isActive ? '#f0fdf4' : '#f9fafb',
                color:      template.isActive ? '#16a34a' : '#6b7280',
                border:     `1px solid ${template.isActive ? '#16a34a30' : '#e5e7eb'}`,
              }}>
              <span>{template.isActive ? '● Active' : '○ Inactive'}</span>
            </button>
          ) : (
            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{
                background: template.isActive ? '#f0fdf4' : '#f9fafb',
                color:      template.isActive ? '#16a34a' : '#6b7280',
              }}>
              {template.isActive ? 'Active' : 'Inactive'}
            </span>
          )}

          <span className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{
              background: template.isValid ? '#f0fdf4' : '#fff7ed',
              color:      template.isValid ? '#16a34a' : '#d97706',
            }}>
            {template.isValid ? '✓ Valid' : 'Unvalidated'}
          </span>
        </div>

        {/* Validate result */}
        {validateResult && (
          <div className="mt-3 p-3 rounded-lg text-sm"
            style={{
              background: validateResult.isValid ? '#f0fdf4' : '#fef2f2',
              border:     `1px solid ${validateResult.isValid ? '#16a34a30' : '#dc262630'}`,
            }}>
            {validateResult.isValid ? (
              <p style={{ color: '#16a34a' }}>✓ Template is valid.</p>
            ) : (
              <div>
                <p className="font-medium mb-1" style={{ color: '#dc2626' }}>Validation errors:</p>
                <ul className="space-y-1">
                  {validateResult.errors.map((e, i) => (
                    <li key={i} className="text-xs" style={{ color: '#dc2626' }}>• {e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-6" style={{ borderColor: 'var(--border)' }}>
        {(['steps', 'rules'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
            style={{
              borderColor: tab === t ? '#2563eb' : 'transparent',
              color:       tab === t ? '#2563eb' : 'var(--muted)',
            }}>
            {t === 'steps' ? `Steps (${template.steps.length})` : `Selection Rules (${template.selectionRules.length})`}
          </button>
        ))}
      </div>

      {/* ── Steps tab ─────────────────────────────────────────────────────── */}
      {tab === 'steps' && (
        <div>
          {canWrite && (
            <div className="flex justify-end mb-4">
              <button onClick={() => { setStepName(''); setShowAddStep(true) }}
                className="text-sm px-4 py-2 rounded-lg font-medium"
                style={{ background: '#2563eb', color: '#fff' }}>
                + Add Step
              </button>
            </div>
          )}

          {sortedSteps.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              No steps defined. Add the first step to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedSteps.map((step, idx) => {
                const typeStyle = STEP_TYPE_COLORS[step.stepType] ?? { color: '#6b7280', bg: '#f3f4f6' }
                const isExp = expanded[step.id] ?? false

                return (
                  <div key={step.id} className="rounded-xl border overflow-hidden"
                    style={{ borderColor: 'var(--border)' }}>
                    {/* Step row */}
                    <div className="flex items-center gap-3 px-4 py-3"
                      style={{ background: 'var(--surface)' }}>
                      {/* Order badge */}
                      <span className="w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-semibold"
                        style={{ background: typeStyle.bg, color: typeStyle.color }}>
                        {step.order}
                      </span>

                      {/* Name + type */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{step.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded font-medium"
                            style={{ background: typeStyle.bg, color: typeStyle.color }}>
                            {step.stepType.replace('_', ' ')}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded"
                            style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                            {step.executionMode}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded"
                            style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                            on missing: {step.onMissingContext}
                          </span>
                        </div>
                        {step.description && (
                          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{step.description}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {canWrite && (
                          <>
                            <button
                              onClick={() => void moveStep(step.id, 'up')}
                              disabled={idx === 0 || reordering === step.id}
                              className="w-7 h-7 rounded flex items-center justify-center text-xs disabled:opacity-30"
                              style={{ color: 'var(--muted)' }} title="Move up">
                              ▲
                            </button>
                            <button
                              onClick={() => void moveStep(step.id, 'down')}
                              disabled={idx === sortedSteps.length - 1 || reordering === step.id}
                              className="w-7 h-7 rounded flex items-center justify-center text-xs disabled:opacity-30"
                              style={{ color: 'var(--muted)' }} title="Move down">
                              ▼
                            </button>
                            {!template.isActive && (
                              <button onClick={() => void deleteStep(step.id)}
                                className="w-7 h-7 rounded flex items-center justify-center text-xs"
                                style={{ color: '#dc2626' }} title="Delete step">
                                ✕
                              </button>
                            )}
                          </>
                        )}
                        <button
                          onClick={() => setExpanded(prev => ({ ...prev, [step.id]: !isExp }))}
                          className="w-7 h-7 rounded flex items-center justify-center text-xs"
                          style={{ color: 'var(--muted)' }} title={isExp ? 'Collapse' : 'Expand config'}>
                          {isExp ? '▼' : '▶'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded config */}
                    {isExp && (
                      <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Config</p>
                            <pre className="text-xs p-2 rounded-lg overflow-x-auto"
                              style={{ background: '#f8fafc', border: '1px solid var(--border)', color: '#334155', maxHeight: 200 }}>
                              {JSON.stringify(step.config, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Next Steps</p>
                            <pre className="text-xs p-2 rounded-lg overflow-x-auto"
                              style={{ background: '#f8fafc', border: '1px solid var(--border)', color: '#334155', maxHeight: 200 }}>
                              {JSON.stringify(step.nextSteps, null, 2)}
                            </pre>
                          </div>
                        </div>
                        {(step.dependencies as string[]).length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Dependencies</p>
                            <p className="text-xs font-mono" style={{ color: 'var(--ink)' }}>
                              {(step.dependencies as string[]).join(', ')}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Selection Rules tab ───────────────────────────────────────────── */}
      {tab === 'rules' && (
        <div>
          {canWrite && (
            <div className="flex justify-end mb-4">
              <button onClick={() => { setRuleConditions([]); setShowAddRule(true) }}
                className="text-sm px-4 py-2 rounded-lg font-medium"
                style={{ background: '#2563eb', color: '#fff' }}>
                + Add Rule
              </button>
            </div>
          )}

          {template.selectionRules.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              No selection rules. Add a rule to control when this template is selected.
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {template.selectionRules.map((rule, i) => {
                const conditions = rule.conditions as Array<{ field: string; operator: string; value: unknown }>
                return (
                  <div key={rule.id}
                    className="flex items-start gap-4 px-5 py-4"
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
                    {/* Priority badge */}
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-semibold"
                      style={{ background: '#eff6ff', color: '#2563eb' }}>
                      P{rule.priority}
                    </div>

                    {/* Rule details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-medium px-2 py-0.5 rounded"
                          style={{ background: '#f1f5f9', color: '#475569' }}>
                          {rule.triggerEvent}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: rule.isActive ? '#f0fdf4' : '#f9fafb',
                            color:      rule.isActive ? '#16a34a' : '#9ca3af',
                          }}>
                          {rule.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {conditions.length === 0 ? (
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>No conditions — matches all objects</p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {conditions.map((c, ci) => (
                            <span key={ci} className="text-xs px-2 py-0.5 rounded font-mono"
                              style={{ background: '#f8fafc', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                              {c.field} {c.operator} {JSON.stringify(c.value)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {canWrite && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => void toggleRule(rule.id, !rule.isActive)}
                          className="text-xs px-3 py-1.5 rounded-lg border"
                          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                          {rule.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => void deleteRule(rule.id)}
                          className="text-xs px-3 py-1.5 rounded-lg"
                          style={{ color: '#dc2626' }}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Add Step Modal ────────────────────────────────────────────────── */}
      {showAddStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--ink)' }}>Add Step</h2>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Name *</label>
                <input
                  value={stepName}
                  onChange={e => setStepName(e.target.value)}
                  placeholder="e.g. Finance Manager Approval"
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Step Type</label>
                <select value={stepType} onChange={e => setStepType(e.target.value as typeof STEP_TYPES[number])}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                  {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Execution Mode</label>
                  <select value={stepExecMode} onChange={e => setStepExecMode(e.target.value as typeof EXEC_MODES[number])}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                    {EXEC_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>On Missing Context</label>
                  <select value={stepMissingCtx} onChange={e => setStepMissingCtx(e.target.value as typeof MISSING_CTXS[number])}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                    {MISSING_CTXS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {addStepError && (
              <p className="text-xs mb-3" style={{ color: '#dc2626' }}>{addStepError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddStep(false)}
                className="px-4 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                Cancel
              </button>
              <button onClick={addStep} disabled={addingStep || !stepName.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}>
                {addingStep ? 'Adding…' : 'Add Step'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Rule Modal ────────────────────────────────────────────────── */}
      {showAddRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4">
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--ink)' }}>Add Selection Rule</h2>

            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Priority</label>
                  <input
                    type="number" min={1} max={999}
                    value={rulePriority}
                    onChange={e => setRulePriority(parseInt(e.target.value) || 100)}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Lower = higher priority</p>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Trigger Event</label>
                  <select value={ruleTrigger} onChange={e => setRuleTrigger(e.target.value as typeof TRIGGER_EVENTS[number])}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                    {TRIGGER_EVENTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Condition builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                    Conditions <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(empty = matches all)</span>
                  </label>
                  <button
                    onClick={() => setRuleConditions(prev => [...prev, { field: '', operator: 'eq', value: '' }])}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    + Add Condition
                  </button>
                </div>
                {ruleConditions.map((cond, ci) => (
                  <div key={ci} className="flex gap-2 mb-2 items-center">
                    <input
                      value={cond.field}
                      onChange={e => setRuleConditions(prev => prev.map((c, i) => i === ci ? { ...c, field: e.target.value } : c))}
                      placeholder="field (e.g. po.totalAmount)"
                      className="flex-1 px-2 py-1.5 rounded border text-xs"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                    />
                    <select
                      value={cond.operator}
                      onChange={e => setRuleConditions(prev => prev.map((c, i) => i === ci ? { ...c, operator: e.target.value } : c))}
                      className="px-2 py-1.5 rounded border text-xs"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                      {['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'exists'].map(op =>
                        <option key={op} value={op}>{op}</option>
                      )}
                    </select>
                    <input
                      value={cond.value}
                      onChange={e => setRuleConditions(prev => prev.map((c, i) => i === ci ? { ...c, value: e.target.value } : c))}
                      placeholder="value"
                      className="flex-1 px-2 py-1.5 rounded border text-xs"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                    />
                    <button onClick={() => setRuleConditions(prev => prev.filter((_, i) => i !== ci))}
                      className="text-xs" style={{ color: '#dc2626' }}>✕</button>
                  </div>
                ))}
              </div>
            </div>

            {addRuleError && (
              <p className="text-xs mb-3" style={{ color: '#dc2626' }}>{addRuleError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddRule(false)}
                className="px-4 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                Cancel
              </button>
              <button onClick={addRule} disabled={addingRule}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}>
                {addingRule ? 'Adding…' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
