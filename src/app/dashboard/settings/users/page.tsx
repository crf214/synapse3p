'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ROLES = ['ADMIN','FINANCE_MANAGER','CONTROLLER','CFO','AP_CLERK','AUDITOR','LEGAL','CISO'] as const
type Role = typeof ROLES[number]

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  ADMIN:           { bg: '#fef2f2', color: '#dc2626' },
  FINANCE_MANAGER: { bg: '#eff6ff', color: '#2563eb' },
  CONTROLLER:      { bg: '#f5f3ff', color: '#7c3aed' },
  CFO:             { bg: '#fff7ed', color: '#d97706' },
  AP_CLERK:        { bg: '#f0fdf4', color: '#16a34a' },
  AUDITOR:         { bg: '#f8fafc', color: '#475569' },
  LEGAL:           { bg: '#fdf4ff', color: '#a21caf' },
  CISO:            { bg: '#fff1f2', color: '#be123c' },
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin', FINANCE_MANAGER: 'Finance Manager', CONTROLLER: 'Controller',
  CFO: 'CFO', AP_CLERK: 'AP Clerk', AUDITOR: 'Auditor', LEGAL: 'Legal', CISO: 'CISO',
}

interface UserRow {
  id:            string
  name:          string | null
  email:         string
  role:          string
  memberStatus:  string
  emailVerified: boolean
  isActive:      boolean
  lastLoginAt:   string | null
  createdAt:     string
}

export default function UsersPage() {
  const { role: myRole, id: myId } = useUser()
  const qc = useQueryClient()

  const [showInvite,   setShowInvite]   = useState(false)
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviteRole,   setInviteRole]   = useState<Role>('AP_CLERK')
  const [inviting,     setInviting]     = useState(false)
  const [inviteMsg,    setInviteMsg]    = useState<string | null>(null)
  const [inviteError,  setInviteError]  = useState<string | null>(null)
  const [roleChanging, setRoleChanging] = useState<string | null>(null)
  const [statusBusy,   setStatusBusy]  = useState<string | null>(null)
  const [actionError,  setActionError]  = useState<string | null>(null)

  const { data, isLoading } = useQuery<{ users: UserRow[] }>({
    queryKey: queryKeys.users.adminList,
    queryFn:  async () => {
      const res  = await fetch('/api/users?admin=1')
      const json = await res.json() as { users: UserRow[]; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      return json
    },
  })

  if (myRole !== 'ADMIN') {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true); setInviteError(null); setInviteMsg(null)
    try {
      const res  = await apiClient('/api/admin/invite-tokens', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) { setInviteError(json.error?.message ?? 'Invite failed'); return }
      setInviteMsg(`Invitation sent to ${inviteEmail.trim()}`)
      setInviteEmail('')
    } catch { setInviteError('Something went wrong') }
    finally { setInviting(false) }
  }

  async function changeRole(userId: string, newRole: Role) {
    setRoleChanging(userId); setActionError(null)
    try {
      const res  = await apiClient(`/api/users/${userId}/role`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ role: newRole }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) { setActionError(json.error?.message ?? 'Role change failed'); return }
      void qc.invalidateQueries({ queryKey: queryKeys.users.adminList })
    } catch { setActionError('Something went wrong') }
    finally { setRoleChanging(null) }
  }

  async function toggleStatus(userId: string, isActive: boolean) {
    setStatusBusy(userId); setActionError(null)
    try {
      const res  = await apiClient(`/api/users/${userId}/status`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ isActive }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) { setActionError(json.error?.message ?? 'Status change failed'); return }
      void qc.invalidateQueries({ queryKey: queryKeys.users.adminList })
    } catch { setActionError('Something went wrong') }
    finally { setStatusBusy(null) }
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Users</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Manage organisation members, roles, and access.
          </p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setInviteMsg(null); setInviteError(null) }}
          className="text-sm px-4 py-2 rounded-lg font-medium"
          style={{ background: '#2563eb', color: '#fff' }}
        >
          + Invite User
        </button>
      </div>

      {actionError && (
        <div className="mb-4 text-sm px-4 py-3 rounded-lg" style={{ background: '#fef2f2', color: '#dc2626' }}>
          {actionError}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : !data?.users.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          No users yet.
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {/* Header */}
          <div className="grid text-xs font-medium px-5 py-3"
            style={{
              gridTemplateColumns: '1fr 1.4fr 140px 90px 110px 110px 130px',
              background: '#f8fafc',
              color: 'var(--muted)',
              borderBottom: '1px solid var(--border)',
            }}>
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Verified</span>
            <span>Last Login</span>
            <span>Joined</span>
            <span>Actions</span>
          </div>

          {data.users.map((u, i) => {
            const colors     = ROLE_COLORS[u.role] ?? { bg: '#f8fafc', color: '#475569' }
            const isSelf     = u.id === myId
            const roleBusy   = roleChanging === u.id
            const statusBusy_ = statusBusy === u.id

            return (
              <div key={u.id}
                className="grid items-center px-5 py-3"
                style={{
                  gridTemplateColumns: '1fr 1.4fr 140px 90px 110px 110px 130px',
                  borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                  opacity: u.isActive ? 1 : 0.55,
                }}>
                <span className="text-sm font-medium truncate pr-2" style={{ color: 'var(--ink)' }}>
                  {u.name ?? '—'}
                  {isSelf && <span className="ml-1 text-xs" style={{ color: 'var(--muted)' }}>(you)</span>}
                </span>

                <span className="text-xs truncate pr-2" style={{ color: 'var(--muted)' }}>{u.email}</span>

                <span>
                  {isSelf || roleBusy ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: colors.bg, color: colors.color }}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  ) : (
                    <select
                      value={u.role}
                      onChange={e => void changeRole(u.id, e.target.value as Role)}
                      disabled={roleBusy}
                      className="text-xs px-2 py-0.5 rounded-lg border"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)', background: '#fff' }}
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  )}
                </span>

                <span>
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: u.emailVerified ? '#f0fdf4' : '#fff7ed',
                      color:      u.emailVerified ? '#16a34a' : '#d97706',
                    }}>
                    {u.emailVerified ? 'Yes' : 'Pending'}
                  </span>
                </span>

                <span className="text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(u.lastLoginAt)}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(u.createdAt)}</span>

                <span>
                  {!isSelf && (
                    <button
                      onClick={() => void toggleStatus(u.id, !u.isActive)}
                      disabled={statusBusy_}
                      className="text-xs px-2.5 py-1 rounded-lg border font-medium disabled:opacity-40"
                      style={{
                        borderColor: u.isActive ? '#fca5a5' : '#86efac',
                        color:       u.isActive ? '#dc2626'  : '#16a34a',
                        background:  u.isActive ? '#fef2f2'  : '#f0fdf4',
                      }}
                    >
                      {statusBusy_ ? '…' : u.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--ink)' }}>Invite User</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Send an invitation email with a registration link.
            </p>

            {inviteMsg ? (
              <div className="space-y-4">
                <div className="px-4 py-3 rounded-lg text-sm"
                  style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                  {inviteMsg}
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setShowInvite(false); setInviteMsg(null) }}
                    className="px-4 py-2 rounded-lg text-sm"
                    style={{ background: '#2563eb', color: '#fff' }}>
                    Done
                  </button>
                  <button onClick={() => { setInviteMsg(null) }}
                    className="px-4 py-2 rounded-lg text-sm border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    Send another
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Email *</label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Role *</label>
                    <select
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as Role)}
                      className="w-full px-3 py-2 rounded-lg border text-sm"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {inviteError && (
                  <p className="text-xs mb-3" style={{ color: '#dc2626' }}>{inviteError}</p>
                )}

                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowInvite(false)}
                    className="px-4 py-2 rounded-lg text-sm border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    Cancel
                  </button>
                  <button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}
                    className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                    style={{ background: '#2563eb', color: '#fff' }}>
                    {inviting ? 'Sending…' : 'Send Invitation'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
