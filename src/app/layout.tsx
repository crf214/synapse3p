// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'
import { CsrfInitializer } from '@/components/shared/CsrfInitializer'

export const metadata: Metadata = {
  title: 'Synapse3P',
  description: 'Synapse3P',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--cream)]">
        <CsrfInitializer />
        {children}
      </body>
    </html>
  )
}
