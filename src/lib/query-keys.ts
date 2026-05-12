// Centralised query key factory.
// All useQuery / useMutation calls must reference keys from this object —
// never use inline string arrays.

export const queryKeys = {
  entities: {
    all:      ['entities']                                         as const,
    detail:   (id: string) => ['entities', id]                    as const,
    workflow: (id: string) => ['entities', id, 'workflow']        as const,
  },

  invoices: {
    all:              ['invoices']                                                    as const,
    list:             (p: Record<string, unknown>) => ['invoices', 'list', p]        as const,
    detail:           (id: string)                 => ['invoices', id]                as const,
    disputes:         (id: string)                 => ['invoices', id, 'disputes']    as const,
    quarantine:       (p: Record<string, unknown>) => ['invoices', 'quarantine', p]   as const,
    eligibleForMerge: ['invoices', 'eligible-for-merge']                              as const,
    workflow:         (id: string) => ['invoices', id, 'workflow']                    as const,
  },

  purchaseOrders: {
    all:      ['purchase-orders']                                        as const,
    detail:   (id: string) => ['purchase-orders', id]                   as const,
    workflow: (id: string) => ['purchase-orders', id, 'workflow']        as const,
  },

  payments: {
    all:    ['payments']                                               as const,
    list:   (p: Record<string, unknown>) => ['payments', 'list', p]    as const,
    detail: (id: string)                 => ['payments', id]           as const,
  },

  paymentExecutions: {
    all:  ['payment-executions']                                              as const,
    list: (p: Record<string, unknown>) => ['payment-executions', 'list', p]   as const,
  },

  approvals: {
    all: ['approvals'] as const,
  },

  mergedAuthorizations: {
    all:    ['merged-authorizations']                                               as const,
    list:   (p: Record<string, unknown>) => ['merged-authorizations', 'list', p]    as const,
    detail: (id: string)                 => ['merged-authorizations', id]           as const,
  },

  contracts: {
    all:    ['contracts']                                     as const,
    detail: (id: string) => ['contracts', id]                as const,
  },

  users: {
    approvers: (roles: string[]) => ['users', 'approvers', roles] as const,
  },

  portal: {
    me: ['portal', 'me'] as const,
    invoices: {
      all:    ['portal', 'invoices']                                                  as const,
      list:   (p: Record<string, unknown>) => ['portal', 'invoices', 'list', p]       as const,
      detail: (id: string)                 => ['portal', 'invoices', id]              as const,
    },
    payments: {
      all:  ['portal', 'payments']                                                 as const,
      list: (p: Record<string, unknown>) => ['portal', 'payments', 'list', p]      as const,
    },
    documents: {
      all:  ['portal', 'documents']                                                as const,
      list: (p: Record<string, unknown>) => ['portal', 'documents', 'list', p]     as const,
    },
  },

  reviews: {
    all:    ['reviews']                                                  as const,
    list:   (p: Record<string, unknown>) => ['reviews', 'list', p]       as const,
    overdue: ['reviews', 'overdue']                                      as const,
  },

  reviewCadences: {
    all: ['review-cadences'] as const,
  },

  dashboard: {
    stats: ['dashboard', 'stats'] as const,
  },
}
