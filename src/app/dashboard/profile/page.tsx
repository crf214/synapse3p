'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

const iCls = 'w-full px-3 py-2 rounded-xl text-sm'
const iSty = { border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }

export default function ProfilePage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [nameMsg, setNameMsg] = useState('')
  const [avatarMsg, setAvatarMsg] = useState('')

  async function handleNameSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSavingName(true)
    setNameMsg('')
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.ok) {
        setNameMsg('Name updated.')
        router.refresh()
      } else {
        setNameMsg('Failed to update name.')
      }
    } finally {
      setSavingName(false)
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (fileRef.current) fileRef.current.value = ''

    setPreview(URL.createObjectURL(file))
    setUploadingAvatar(true)
    setAvatarMsg('')
    try {
      const fd = new FormData()
      fd.append('avatar', file)
      const res = await fetch('/api/user', { method: 'POST', body: fd })
      if (res.ok) {
        setAvatarMsg('Avatar updated.')
        router.refresh()
      } else {
        setAvatarMsg('Upload failed.')
        setPreview(null)
      }
    } finally {
      setUploadingAvatar(false)
    }
  }

  return (
    <div className="p-8 max-w-lg fade-up">
      <h1 className="font-display text-3xl mb-8" style={{ color: 'var(--ink)' }}>Profile</h1>

      {/* Avatar */}
      <div className="rounded-2xl p-6 mb-5" style={{ border: '1px solid var(--border)', background: '#fff' }}>
        <h2 className="text-sm font-medium mb-4" style={{ color: 'var(--ink)' }}>Profile picture</h2>
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-2xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            {preview
              ? <img src={preview} alt="" className="w-full h-full object-cover" />
              : <span style={{ color: 'var(--muted)' }}>?</span>
            }
          </div>
          <div>
            <button type="button" onClick={() => fileRef.current?.click()}
              disabled={uploadingAvatar}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: 'var(--ink)', color: '#fff', opacity: uploadingAvatar ? 0.6 : 1 }}>
              {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            {avatarMsg && <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{avatarMsg}</p>}
          </div>
        </div>
      </div>

      {/* Name */}
      <div className="rounded-2xl p-6" style={{ border: '1px solid var(--border)', background: '#fff' }}>
        <h2 className="text-sm font-medium mb-4" style={{ color: 'var(--ink)' }}>Display name</h2>
        <form onSubmit={handleNameSave} className="flex gap-3">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className={iCls + ' flex-1'}
            style={iSty}
            placeholder="Your name"
          />
          <button type="submit" disabled={savingName || !name.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium flex-shrink-0"
            style={{ background: 'var(--ink)', color: '#fff', opacity: (savingName || !name.trim()) ? 0.5 : 1 }}>
            {savingName ? 'Saving…' : 'Save'}
          </button>
        </form>
        {nameMsg && <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{nameMsg}</p>}
      </div>
    </div>
  )
}
