import type { ErpTransactionType } from '@prisma/client'

export type { ErpTransactionType }

export interface NetSuiteVendor {
  erpId: string
  name: string
  email?: string
  phone?: string
  address?: string
  currency: string
  isActive: boolean
  lastModified: Date
}

export interface NetSuitePurchaseOrder {
  erpId: string
  poNumber: string
  vendorErpId: string
  amount: number
  currency: string
  status: string
  createdDate: Date
  memo?: string
}

export interface NetSuiteTransaction {
  erpId: string
  type: ErpTransactionType
  transactionDate: Date
  amount: number
  currency: string
  vendorRef?: string
  paymentReference?: string
  period: string
  periodClosed: boolean
  memo?: string
}

export interface PaymentInstructionPayload {
  instructionId: string
  vendorErpId: string
  bankAccount: {
    accountNo: string
    routingNo?: string
    swiftBic?: string
  }
  amount: number
  currency: string
  dueDate?: Date
  poReference?: string
  memo?: string
}

export interface PaymentConfirmation {
  instructionId: string
  erpReference: string
  executedAt: Date
  amount: number
  currency: string
  status: 'SUCCESS' | 'FAILED'
  failureReason?: string
}

export interface ErpSyncResult {
  transactionsChecked: number
  transactionsChanged: number
  thirdPartyRelevant: number
  newTransactions: number
  errors: Array<{ erpId: string; error: string }>
}

export interface PeriodStatus {
  period: string
  isOpen: boolean
  closedAt?: Date
}
