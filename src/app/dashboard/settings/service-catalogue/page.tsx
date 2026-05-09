'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

interface CatalogueNode {
  id:          string
  name:        string
  parentId:    string | null
  description: string | null
  isActive:    boolean
  sortOrder:   number
  children:    CatalogueNode[]
}

function buildTree(flat: Omit<CatalogueNode, 'children'>[]): CatalogueNode[] {
  const map = new Map<string, CatalogueNode>()
  for (const n of flat) map.set(n.id, { ...n, children: [] })
  const roots: CatalogueNode[] = []
  for (const n of map.values()) {
    if (n.parentId && map.has(n.parentId)) {
      map.get(n.parentId)!.children.push(n)
    } else {
      roots.push(n)
    }
  }
  function sortChildren(nodes: CatalogueNode[]) {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    nodes.forEach(n => sortChildren(n.children))
  }
  sortChildren(roots)
  return roots
}

function countDescendants(node: CatalogueNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0)
}

function NodeModal({
  initial,
  parentName,
  onSave,
  onClose,
}: {
  initial?: CatalogueNode | null
  parentName?: string | null
  onSave: (data: { name: string; description: string | null }) => Promise<void>
  onClose: () => void
}) {
  const [name, setName]     = useState(initial?.name ?? '')
  const [desc, setDesc]     = useState(initial?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError(null)
    try {
      await onSave({ name: name.trim(), description: desc.trim() || null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md rounded-2xl shadow-xl"
        style={{ background: '#fff', border: '1px solid var(--border)' }}>
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            {initial ? 'Edit Service' : parentName ? `Add under "${parentName}"` : 'New Root Category'}
          </h2>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
              Name <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
              Description <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
            </label>
            <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm resize-none outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
              style={{ background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
              {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TreeNode({
  node,
  depth,
  isAdmin,
  onEdit,
  onAddChild,
  onToggleActive,
  onDelete,
}: {
  node:           CatalogueNode
  depth:          number
  isAdmin:        boolean
  onEdit:         (node: CatalogueNode) => void
  onAddChild:     (node: CatalogueNode) => void
  onToggleActive: (node: CatalogueNode) => void
  onDelete:       (node: CatalogueNode) => void
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl group"
        style={{
          marginLeft:  depth * 20,
          background:  node.isActive ? 'transparent' : '#f8fafc',
          opacity:     node.isActive ? 1 : 0.65,
          border:      '1px solid transparent',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
        onMouseLeave={e => (e.currentTarget.style.background = node.isActive ? 'transparent' : '#f8fafc')}
      >
        <button type="button"
          onClick={() => hasChildren && setOpen(o => !o)}
          className="w-5 h-5 flex items-center justify-center flex-shrink-0"
          style={{ cursor: hasChildren ? 'pointer' : 'default', color: 'var(--muted)' }}>
          {hasChildren
            ? <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb' }}>{open ? '▼' : '▶'}</span>
            : <span style={{ fontSize: 8, color: 'var(--muted)' }}>◦</span>
          }
        </button>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{node.name}</span>
          {!node.isActive && (
            <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: '#f1f5f9', color: '#94a3b8' }}>Inactive</span>
          )}
          {node.description && (
            <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>{node.description}</span>
          )}
          {hasChildren && (
            <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>
              {countDescendants(node)} item{countDescendants(node) !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {isAdmin && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" onClick={() => onAddChild(node)}
              className="px-2 py-1 rounded-lg text-xs"
              style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', cursor: 'pointer' }}
              title="Add child">
              + Child
            </button>
            <button type="button" onClick={() => onEdit(node)}
              className="px-2 py-1 rounded-lg text-xs"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
              Edit
            </button>
            <button type="button" onClick={() => onToggleActive(node)}
              className="px-2 py-1 rounded-lg text-xs"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
              {node.isActive ? 'Deactivate' : 'Activate'}
            </button>
            {!hasChildren && (
              <button type="button" onClick={() => onDelete(node)}
                className="px-2 py-1 rounded-lg text-xs"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', cursor: 'pointer' }}>
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      {open && hasChildren && (
        <div style={{ marginLeft: depth * 20 + 12, borderLeft: '1px solid var(--border)', paddingLeft: 4 }}>
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} depth={0}
              isAdmin={isAdmin}
              onEdit={onEdit} onAddChild={onAddChild}
              onToggleActive={onToggleActive} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ServiceCataloguePage() {
  const user    = useUser()
  const isAdmin = user.role === 'ADMIN'

  const [tree,    setTree]    = useState<CatalogueNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const [modal, setModal] = useState<'root' | { addChild: CatalogueNode } | { edit: CatalogueNode } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-catalogue?includeInactive=${isAdmin}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
      }
      const { entries } = await res.json()
      setTree(buildTree(entries))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load service catalogue.')
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { load() }, [load])

  async function handleSave(data: { name: string; description: string | null }) {
    if (modal === 'root') {
      const res = await apiClient('/api/service-catalogue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, parentId: null }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error?.message ?? 'Failed') }
    } else if (modal && 'addChild' in modal) {
      const res = await apiClient('/api/service-catalogue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, parentId: modal.addChild.id }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error?.message ?? 'Failed') }
    } else if (modal && 'edit' in modal) {
      const res = await apiClient(`/api/service-catalogue/${modal.edit.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error?.message ?? 'Failed') }
    }
    setModal(null)
    await load()
  }

  async function handleToggleActive(node: CatalogueNode) {
    await apiClient(`/api/service-catalogue/${node.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !node.isActive }),
    })
    await load()
  }

  async function handleDelete(node: CatalogueNode) {
    if (!confirm(`Remove "${node.name}"?`)) return
    await apiClient(`/api/service-catalogue/${node.id}`, { method: 'DELETE' })
    await load()
  }

  const modalInitial    = modal !== null && modal !== 'root' && 'edit'     in modal ? modal.edit     : null
  const modalParentName = modal !== null && modal !== 'root' && 'addChild' in modal ? modal.addChild.name : null

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Service Catalogue</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Hierarchical service taxonomy. Each entity engagement maps to a service node and must reference a contract.
          </p>
        </div>
        {isAdmin && (
          <button type="button" onClick={() => setModal('root')}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
            + New Category
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
      ) : tree.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--muted)' }}>
          <p className="text-sm mb-2">No service categories defined.</p>
          {isAdmin && (
            <button type="button" onClick={() => setModal('root')}
              className="text-sm" style={{ color: '#2563eb' }}>
              Create first category →
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl p-4 space-y-0.5"
          style={{ border: '1px solid var(--border)', background: '#fff' }}>
          {tree.map(node => (
            <TreeNode key={node.id} node={node} depth={0}
              isAdmin={isAdmin}
              onEdit={n => setModal({ edit: n })}
              onAddChild={n => setModal({ addChild: n })}
              onToggleActive={handleToggleActive}
              onDelete={handleDelete} />
          ))}
        </div>
      )}

      {modal !== null && (
        <NodeModal
          initial={modalInitial}
          parentName={modalParentName}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
