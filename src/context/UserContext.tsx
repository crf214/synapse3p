'use client'
import { createContext, useContext } from 'react'

export interface UserContextValue {
  id: string
  email: string
  name?: string | null
  avatar?: string | null
  orgId?: string
  role?: string
}

const UserContext = createContext<UserContextValue | null>(null)

export function UserProvider({
  children,
  ...value
}: UserContextValue & { children: React.ReactNode }) {
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be used within a UserProvider')
  return ctx
}
