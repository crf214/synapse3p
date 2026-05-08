// App definitions: theme colors, path ownership, nav structure
export type AppId = 'entity' | 'invoice' | 'payment' | 'settings' | 'platform'

export interface AppTheme {
  accent: string   // primary hex color
  soft:   string   // light background hex
  border: string   // border rgba
  text:   string   // darker text hex
  name:   string   // display name
  icon:   string   // sidebar icon character
}

export const APP_THEMES: Record<AppId, AppTheme> = {
  entity: {
    accent: '#2563eb',
    soft:   '#eff6ff',
    border: 'rgba(37,99,235,0.13)',
    text:   '#1d4ed8',
    name:   'Entity Management',
    icon:   '◑',
  },
  invoice: {
    accent: '#7c3aed',
    soft:   '#f5f3ff',
    border: 'rgba(124,58,237,0.13)',
    text:   '#6d28d9',
    name:   'Invoice & PO',
    icon:   '◎',
  },
  payment: {
    accent: '#059669',
    soft:   '#ecfdf5',
    border: 'rgba(5,150,105,0.13)',
    text:   '#047857',
    name:   'Payments & ERP',
    icon:   '◈',
  },
  settings: {
    accent: '#64748b',
    soft:   '#f1f5f9',
    border: 'rgba(100,116,139,0.13)',
    text:   '#475569',
    name:   'Global Settings',
    icon:   '⚙',
  },
  platform: {
    accent: '#475569',
    soft:   '#f8fafc',
    border: 'rgba(71,85,105,0.13)',
    text:   '#334155',
    name:   'Synapse3P',
    icon:   '◈',
  },
}

// Path → app mapping (order matters: more specific first)
const APP_PATH_MAP: Array<{ prefix: string; app: AppId }> = [
  // Entity paths
  { prefix: '/dashboard/entities',                       app: 'entity'   },
  { prefix: '/dashboard/reviews',                        app: 'entity'   },
  { prefix: '/dashboard/contracts',                      app: 'entity'   },
  { prefix: '/dashboard/documents',                      app: 'entity'   },
  // Invoice & PO paths
  { prefix: '/dashboard/invoices',                       app: 'invoice'  },
  { prefix: '/dashboard/purchase-orders',                app: 'invoice'  },
  { prefix: '/dashboard/service-engagements',            app: 'invoice'  },
  { prefix: '/dashboard/merged-authorizations',          app: 'invoice'  },
  { prefix: '/dashboard/approvals',                      app: 'invoice'  },
  // Payments & ERP paths
  { prefix: '/dashboard/payments',                       app: 'payment'  },
  // Global Settings paths (all /dashboard/settings/* → settings)
  { prefix: '/dashboard/settings',                       app: 'settings' },
  { prefix: '/dashboard/profile',                        app: 'settings' },
]

export function getAppFromPath(pathname: string): AppId {
  for (const { prefix, app } of APP_PATH_MAP) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return app
  }
  return 'platform'
}
