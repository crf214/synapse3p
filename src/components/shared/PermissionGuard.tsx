'use client'
import { useUser } from '@/context/UserContext'

interface Props {
  roles: string[]
  children: React.ReactNode
}

export default function PermissionGuard({ roles, children }: Props) {
  const { role } = useUser()
  if (!role || !roles.includes(role)) return null
  return <>{children}</>
}
