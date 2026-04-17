import type IErpAdapter from './IErpAdapter'
import type {
  NetSuiteVendor,
  NetSuitePurchaseOrder,
  NetSuiteTransaction,
  PaymentInstructionPayload,
  PaymentConfirmation,
  PeriodStatus,
} from './types'

// ---------------------------------------------------------------------------
// Static mock data
// ---------------------------------------------------------------------------

const MOCK_VENDORS: NetSuiteVendor[] = [
  { erpId: '4521', name: 'Amazon Web Services',   email: 'billing@aws.amazon.com',         currency: 'USD', isActive: true, lastModified: new Date('2026-03-01') },
  { erpId: '4522', name: 'Microsoft Corporation', email: 'msbill@microsoft.com',            currency: 'USD', isActive: true, lastModified: new Date('2026-02-15') },
  { erpId: '4523', name: 'Stripe Inc',            email: 'billing@stripe.com',              currency: 'USD', isActive: true, lastModified: new Date('2026-03-10') },
  { erpId: '4524', name: 'Cloudflare Inc',        email: 'billing@cloudflare.com',          currency: 'USD', isActive: true, lastModified: new Date('2026-01-20') },
  { erpId: '4525', name: 'GitHub Inc',            email: 'billing@github.com',              currency: 'USD', isActive: true, lastModified: new Date('2026-03-05') },
]

const MOCK_POS: NetSuitePurchaseOrder[] = [
  { erpId: 'PO-8801', poNumber: 'PO-2026-001', vendorErpId: '4521', amount: 24000, currency: 'USD', status: 'Fully Billed', createdDate: new Date('2026-01-10'), memo: 'Annual AWS infrastructure' },
  { erpId: 'PO-8802', poNumber: 'PO-2026-002', vendorErpId: '4522', amount: 8400,  currency: 'USD', status: 'Open',         createdDate: new Date('2026-02-01'), memo: 'Microsoft 365 licences' },
  { erpId: 'PO-8803', poNumber: 'PO-2026-003', vendorErpId: '4523', amount: 3600,  currency: 'USD', status: 'Open',         createdDate: new Date('2026-03-15'), memo: 'Stripe processing fees Q1' },
]

const MOCK_TRANSACTIONS: NetSuiteTransaction[] = [
  { erpId: 'BILL-10001', type: 'VENDOR_BILL',    transactionDate: new Date('2025-11-28'), amount: 1980,   currency: 'USD', vendorRef: '4521', period: '2025-11', periodClosed: true,  memo: 'AWS Nov invoice' },
  { erpId: 'BILL-10002', type: 'VENDOR_BILL',    transactionDate: new Date('2025-12-29'), amount: 2100,   currency: 'USD', vendorRef: '4521', period: '2025-12', periodClosed: true,  memo: 'AWS Dec invoice' },
  { erpId: 'PAY-10001',  type: 'VENDOR_PAYMENT', transactionDate: new Date('2025-12-05'), amount: 1980,   currency: 'USD', vendorRef: '4521', paymentReference: 'ACH-991122', period: '2025-12', periodClosed: true },
  { erpId: 'BILL-10003', type: 'VENDOR_BILL',    transactionDate: new Date('2026-01-28'), amount: 700,    currency: 'USD', vendorRef: '4522', period: '2026-01', periodClosed: true,  memo: 'Microsoft 365 Jan' },
  { erpId: 'BILL-10004', type: 'VENDOR_BILL',    transactionDate: new Date('2026-01-31'), amount: 2050,   currency: 'USD', vendorRef: '4521', period: '2026-01', periodClosed: true,  memo: 'AWS Jan invoice' },
  { erpId: 'PAY-10002',  type: 'VENDOR_PAYMENT', transactionDate: new Date('2026-01-15'), amount: 2100,   currency: 'USD', vendorRef: '4521', paymentReference: 'ACH-991244', period: '2026-01', periodClosed: true },
  { erpId: 'BILL-10005', type: 'VENDOR_BILL',    transactionDate: new Date('2026-02-28'), amount: 2200,   currency: 'USD', vendorRef: '4521', period: '2026-02', periodClosed: true,  memo: 'AWS Feb invoice' },
  { erpId: 'BILL-10006', type: 'VENDOR_BILL',    transactionDate: new Date('2026-02-28'), amount: 300,    currency: 'USD', vendorRef: '4524', period: '2026-02', periodClosed: true,  memo: 'Cloudflare Feb' },
  { erpId: 'BILL-10007', type: 'VENDOR_BILL',    transactionDate: new Date('2026-03-28'), amount: 2350,   currency: 'USD', vendorRef: '4521', period: '2026-03', periodClosed: true,  memo: 'AWS Mar invoice' },
  { erpId: 'BILL-10008', type: 'VENDOR_BILL',    transactionDate: new Date('2026-04-10'), amount: 2350,   currency: 'USD', vendorRef: '4521', period: '2026-04', periodClosed: false, memo: 'AWS Apr invoice' },
]

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

function buildPeriods(): PeriodStatus[] {
  const now = new Date()
  const periods: PeriodStatus[] = []

  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const isOpen = i === 0
    periods.push({
      period,
      isOpen,
      closedAt: isOpen ? undefined : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 5)),
    })
  }

  return periods
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export class MockErpAdapter implements IErpAdapter {
  async testConnection() {
    return { connected: true, accountId: 'MOCK-ACCOUNT-123' }
  }

  async getVendors(since?: Date): Promise<NetSuiteVendor[]> {
    if (!since) return MOCK_VENDORS
    return MOCK_VENDORS.filter(v => v.lastModified >= since)
  }

  async getVendorById(erpId: string): Promise<NetSuiteVendor | null> {
    return MOCK_VENDORS.find(v => v.erpId === erpId) ?? null
  }

  async getPurchaseOrders(since?: Date): Promise<NetSuitePurchaseOrder[]> {
    if (!since) return MOCK_POS
    return MOCK_POS.filter(po => po.createdDate >= since)
  }

  async getTransactions(since?: Date, vendorErpIds?: string[]): Promise<NetSuiteTransaction[]> {
    let results = MOCK_TRANSACTIONS
    if (since)          results = results.filter(t => t.transactionDate >= since)
    if (vendorErpIds?.length) results = results.filter(t => t.vendorRef && vendorErpIds.includes(t.vendorRef))
    return results
  }

  async getTransactionById(erpId: string): Promise<NetSuiteTransaction | null> {
    return MOCK_TRANSACTIONS.find(t => t.erpId === erpId) ?? null
  }

  async getPeriods(): Promise<PeriodStatus[]> {
    return buildPeriods()
  }

  async sendPaymentInstruction(payload: PaymentInstructionPayload): Promise<PaymentConfirmation> {
    await new Promise(resolve => setTimeout(resolve, 500))
    const ref = `BILL-2026-04-${payload.instructionId.slice(-6).toUpperCase()}`
    return {
      instructionId: payload.instructionId,
      erpReference:  ref,
      executedAt:    new Date(),
      amount:        payload.amount,
      currency:      payload.currency,
      status:        'SUCCESS',
    }
  }

  async sendPaymentCorrection(
    originalErpReference: string,
    payload: PaymentInstructionPayload,
    _reason: string,
  ): Promise<PaymentConfirmation> {
    await new Promise(resolve => setTimeout(resolve, 500))
    const ref = `CORR-${originalErpReference}`
    return {
      instructionId: payload.instructionId,
      erpReference:  ref,
      executedAt:    new Date(),
      amount:        payload.amount,
      currency:      payload.currency,
      status:        'SUCCESS',
    }
  }
}
