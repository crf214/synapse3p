import type IErpAdapter from './IErpAdapter'
import type {
  NetSuiteVendor,
  NetSuitePurchaseOrder,
  NetSuiteTransaction,
  PaymentInstructionPayload,
  PaymentConfirmation,
  PeriodStatus,
} from './types'

interface NetSuiteTbaConfig {
  accountId: string
  consumerKey: string
  consumerSecret: string
  tokenId: string
  tokenSecret: string
}

const NOT_IMPLEMENTED =
  'NetSuite REST adapter not yet configured. Set NETSUITE_ACCOUNT_ID and credentials in environment variables to enable.'

export class NetSuiteRestAdapter implements IErpAdapter {
  private readonly baseUrl: string

  constructor(private readonly config: NetSuiteTbaConfig) {
    this.baseUrl = `https://${config.accountId}.suitetalk.api.netsuite.com/services/rest/record/v1`
  }

  // TODO: Implement OAuth 1.0a TBA header generation using consumerKey,
  // consumerSecret, tokenId, tokenSecret. NetSuite requires HMAC-SHA256
  // signatures on every request. Use the 'oauth-1.0a' npm package.
  // private buildAuthHeader(method: string, url: string): string { ... }

  async testConnection(): Promise<{ connected: boolean; accountId?: string; error?: string }> {
    // TODO: GET {baseUrl}/customer?limit=1 with TBA auth header.
    // A 200 response confirms connectivity and valid credentials.
    throw new Error(NOT_IMPLEMENTED)
  }

  async getVendors(_since?: Date): Promise<NetSuiteVendor[]> {
    // TODO: GET {baseUrl}/vendor
    // Filter with query: ?q=lastModifiedDate AFTER "{since.toISOString()}"
    // Map NetSuite vendor fields to NetSuiteVendor shape:
    //   id → erpId, companyName → name, email, phone, defaultAddress → address,
    //   currency.refName → currency, isInactive (invert) → isActive, lastModifiedDate → lastModified
    throw new Error(NOT_IMPLEMENTED)
  }

  async getVendorById(_erpId: string): Promise<NetSuiteVendor | null> {
    // TODO: GET {baseUrl}/vendor/{erpId}
    // Return null if 404, throw on other errors.
    throw new Error(NOT_IMPLEMENTED)
  }

  async getPurchaseOrders(_since?: Date): Promise<NetSuitePurchaseOrder[]> {
    // TODO: GET {baseUrl}/purchaseOrder
    // Filter with query: ?q=createdDate AFTER "{since.toISOString()}"
    // Map: id → erpId, tranId → poNumber, entity.id → vendorErpId,
    //   total → amount, currency.refName → currency, status → status,
    //   tranDate → createdDate, memo → memo
    throw new Error(NOT_IMPLEMENTED)
  }

  async getTransactions(_since?: Date, _vendorErpIds?: string[]): Promise<NetSuiteTransaction[]> {
    // TODO: Fetch both /vendorbill and /vendorpayment in parallel.
    // Filter by tranDate AFTER since, and optionally by entity IN vendorErpIds.
    // Map common fields:
    //   id → erpId, type: 'VENDOR_BILL' or 'VENDOR_PAYMENT' → ErpTransactionType,
    //   tranDate → transactionDate, total → amount, currency.refName → currency,
    //   entity.id → vendorRef, tranId → paymentReference,
    //   postingPeriod.refName → period (format as "YYYY-MM"),
    //   postingPeriod.isLocked → periodClosed, memo → memo
    throw new Error(NOT_IMPLEMENTED)
  }

  async getTransactionById(_erpId: string): Promise<NetSuiteTransaction | null> {
    // TODO: Try GET {baseUrl}/vendorbill/{erpId} first, then /vendorpayment/{erpId}.
    // Return null if both 404.
    throw new Error(NOT_IMPLEMENTED)
  }

  async getPeriods(): Promise<PeriodStatus[]> {
    // TODO: GET {baseUrl}/accountingPeriod
    // Filter to fiscal periods (not quarters/years): ?q=isYear IS false AND isQuarter IS false
    // Map: refName → period (parse to "YYYY-MM"), isLocked → !isOpen,
    //   endDate (day after period close) → closedAt
    throw new Error(NOT_IMPLEMENTED)
  }

  async sendPaymentInstruction(payload: PaymentInstructionPayload): Promise<PaymentConfirmation> {
    // TODO: POST {baseUrl}/vendorpayment
    // Body shape:
    //   { entity: { id: payload.vendorErpId },
    //     tranDate: payload.dueDate ?? new Date(),
    //     currency: { refName: payload.currency },
    //     applyList: { apply: [{ doc: { id: <vendor bill internal id> }, apply: true, amount: payload.amount }] },
    //     memo: payload.memo }
    // On success (201) return PaymentConfirmation with erpReference = response body id.
    // On failure map the NetSuite error message to failureReason.
    throw new Error(NOT_IMPLEMENTED)
  }

  async sendPaymentCorrection(
    _originalErpReference: string,
    _payload: PaymentInstructionPayload,
    _reason: string,
  ): Promise<PaymentConfirmation> {
    // TODO: NetSuite does not support direct payment amendments.
    // Strategy: void the original payment via POST {baseUrl}/vendorpayment/{originalErpReference}/!transform/vendorCreditMemo
    // then create a new vendorpayment with the corrected payload.
    // Attach _reason as the memo on the credit memo.
    // Return the new payment's confirmation with CORR- prefix on erpReference.
    throw new Error(NOT_IMPLEMENTED)
  }
}
