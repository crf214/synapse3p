'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER'])

interface TemplateRow {
  id:               string
  name:             string
  description:      string | null
  targetObjectType: string
  isActive:         boolean
  isValid:          boolean
  version:          number
  _count:           { steps: number; instances: number }
  selectionRules:   { id: string; isActive: boolean }[]
}

interface TemplatesResponse {
  templates: {
    ENTITY:         TemplateRow[]
    INVOICE:        TemplateRow[]
    PURCHASE_ORDER: TemplateRow[]
  }
}

const OBJECT_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  ENTITY:         { label: 'Entity',          color: '#2563eb', bg: '#eff6ff' },
  INVOICE:        { label: 'Invoice',          color: '#7c3aed', bg: '#f5f3ff' },
  PURCHASE_ORDER: { label: 'Purchase Order',   color: '#d97706', bg: '#fffbeb' },
}

export default function WorkflowTemplatesPage() {
  const { role } = useUser()
  const router   = useRouter()
  const qc       = useQueryClient()

  const [showModal,   setShowModal]   = useState(false)
  const [modalType,   setModalType]   = useState<'ENTITY' | 'INVOICE' | 'PURCHASE_ORDER'>('INVOICE')
  const [newName,     setNewName]     = useState('')
  const [newDesc,     setNewDesc]     = useState('')
  const [creating,    setCreating]    = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workflowTemplates.list(),
    queryFn:  async () => {
      const res  = await fetch('/api/workflow-templates')
      const json = await res.json() as TemplatesResponse & { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      return json.templates
    },
  })

  if (!role || !ALLOWED_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  async function createTemplate() {
    if (!newName.trim()) return
    setCreating(true); setCreateError(null)
    try {
      const res  = await apiClient('/api/workflow-templates', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: newName.trim(), targetObjectType: modalType, description: newDesc.trim() || undefined }),
      })
      const json = await res.json() as { template?: { id: string }; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Create failed')
      void qc.invalidateQueries({ queryKey: queryKeys.workflowTemplates.list() })
      setShowModal(false); setNewName(''); setNewDesc('')
      if (json.template?.id) router.push(`/dashboard/settings/workflow-templates/${json.template.id}`)
    } catch (e) { setCreateError(e instanceof Error ? e.message : 'Create failed') }
    finally { setCreating(false) }
  }

  function openNew(type: 'ENTITY' | 'INVOICE' | 'PURCHASE_ORDER') {
    setModalType(type); setNewName(''); setNewDesc(''); setCreateError(null); setShowModal(true)
  }

  function renderSection(key: 'ENTITY' | 'INVOICE' | 'PURCHASE_ORDER', rows: TemplateRow[]) {
    const meta = OBJECT_TYPE_LABELS[key]
    return (
      <div key={key} className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: meta.bg, color: meta.color }}>
              {meta.label}
            </span>
            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              Workflow Templates
            </span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {rows.length} template{rows.length !== 1 ? 's' : ''}
            </span>
          </div>
          {role && WRITE_ROLES.has(role) && (
            <button onClick={() => openNew(key)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}30` }}>
              + New Template
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            No {meta.label.toLowerCase()} templates yet.
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {rows.map((t, i) => (
              <button key={t.id}
                onClick={() => router.push(`/dashboard/settings/workflow-templates/${t.id}`)}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-gray-50"
                style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{t.name}</div>
                  {t.description && (
                    <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{t.description}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {t._count.steps} step{t._count.steps !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    v{t.version}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: t.isActive ? '#f0fdf4' : '#f9fafb',
                      color:      t.isActive ? '#16a34a' : '#9ca3af',
                    }}>
                    {t.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: t.isValid ? '#f0fdf4' : '#fff7ed',
                      color:      t.isValid ? '#16a34a' : '#d97706',
                    }}>
                    {t.isValid ? 'Valid' : 'Unvalidated'}
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>›</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--ink)' }}>Workflow Templates</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>
        Configure workflow templates that control how entities, invoices, and purchase orders are processed.
        Templates define approval chains, auto-rules, and notifications for each object type.
      </p>

      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : data ? (
        <>
          {renderSection('ENTITY',         data.ENTITY)}
          {renderSection('INVOICE',        data.INVOICE)}
          {renderSection('PURCHASE_ORDER', data.PURCHASE_ORDER)}
        </>
      ) : null}

      {/* New Template Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--ink)' }}>New Template</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Creating a {OBJECT_TYPE_LABELS[modalType].label} workflow template.
            </p>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Name *</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Standard PO Review"
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Description</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={2}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                />
              </div>
            </div>

            {createError && (
              <p className="text-xs mb-3" style={{ color: '#dc2626' }}>{createError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                Cancel
              </button>
              <button onClick={createTemplate} disabled={creating || !newName.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}>
                {creating ? 'Creating…' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
