'use client'
import { usePathname } from 'next/navigation'
import { getAppFromPath, APP_THEMES } from '@/lib/apps'

export function AppThemeBar() {
  const pathname = usePathname()
  const app = getAppFromPath(pathname)
  const theme = APP_THEMES[app]

  return (
    <div
      style={{
        height: 3,
        background: theme.accent,
        transition: 'background 0.3s ease',
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  )
}
