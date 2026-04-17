import type {
  NetSuiteVendor,
  NetSuitePurchaseOrder,
  NetSuiteTransaction,
  PaymentInstructionPayload,
  PaymentConfirmation,
  ErpSyncResult,
  PeriodStatus,
} from './types'

export type { ErpSyncResult }

export default interface IErpAdapter {
  // Vendor master sync
  getVendors(since?: Date): Promise<NetSuiteVendor[]>
  getVendorById(erpId: string): Promise<NetSuiteVendor | null>

  // Purchase order sync
  getPurchaseOrders(since?: Date): Promise<NetSuitePurchaseOrder[]>

  // Transaction sync — only third-party relevant
  getTransactions(since?: Date, vendorErpIds?: string[]): Promise<NetSuiteTransaction[]>
  getTransactionById(erpId: string): Promise<NetSuiteTransaction | null>

  // Period management
  getPeriods(): Promise<PeriodStatus[]>

  // Payment instruction outbound
  sendPaymentInstruction(payload: PaymentInstructionPayload): Promise<PaymentConfirmation>

  // Correction — called when an amendment is approved post-send
  sendPaymentCorrection(
    originalErpReference: string,
    payload: PaymentInstructionPayload,
    reason: string,
  ): Promise<PaymentConfirmation>

  // Health check
  testConnection(): Promise<{ connected: boolean; accountId?: string; error?: string }>
}
