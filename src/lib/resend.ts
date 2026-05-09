// src/lib/resend.ts
import { Resend } from 'resend'

// ---------------------------------------------------------------------------
// Client (singleton)
// ---------------------------------------------------------------------------

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.RESEND_FROM_EMAIL ?? 'invoices@synapse3p.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Invoice routing notification
// ---------------------------------------------------------------------------

export interface InvoiceAssignedEmailParams {
  to: string
  assigneeName: string
  invoiceNo: string
  vendorName: string
  amount: number
  currency: string
  invoiceId: string
}

export async function sendInvoiceAssignedEmail(p: InvoiceAssignedEmailParams): Promise<void> {
  const reviewUrl = `${APP_URL}/dashboard/invoices/${p.invoiceId}/approve`
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency }).format(p.amount)

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `Invoice ${p.invoiceNo} from ${p.vendorName} requires your approval`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #fff;">
        <div style="font-size: 20px; font-weight: 600; color: #111; margin-bottom: 8px;">Invoice awaiting approval</div>
        <p style="color: #555; margin: 0 0 24px;">Hi ${p.assigneeName}, an invoice has been routed to you for review.</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Vendor</td><td style="padding: 8px 0; font-weight: 500; color: #111; font-size: 13px; text-align: right;">${p.vendorName}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Invoice #</td><td style="padding: 8px 0; font-weight: 500; color: #111; font-size: 13px; text-align: right;">${p.invoiceNo}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Amount</td><td style="padding: 8px 0; font-weight: 600; color: #111; font-size: 13px; text-align: right;">${formatted}</td></tr>
        </table>
        <a href="${reviewUrl}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Review Invoice</a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">Synapse3P · <a href="${APP_URL}" style="color: #aaa;">Open platform</a></p>
      </div>
    `,
  })
}

// ---------------------------------------------------------------------------
// PO submitted — notify approver
// ---------------------------------------------------------------------------

export interface POSubmittedEmailParams {
  to: string
  assigneeName: string
  poNumber: string
  vendorName: string
  totalAmount: number
  currency: string
  poId: string
  stepLabel: string
}

export async function sendPOSubmittedEmail(p: POSubmittedEmailParams): Promise<void> {
  const reviewUrl = `${APP_URL}/dashboard/purchase-orders/${p.poId}`
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency }).format(p.totalAmount)

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `PO ${p.poNumber} from ${p.vendorName} requires your approval`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #fff;">
        <div style="font-size: 20px; font-weight: 600; color: #111; margin-bottom: 8px;">Purchase order awaiting approval</div>
        <p style="color: #555; margin: 0 0 24px;">Hi ${p.assigneeName}, a purchase order has been submitted for your review (${p.stepLabel}).</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Vendor</td><td style="padding: 8px 0; font-weight: 500; color: #111; font-size: 13px; text-align: right;">${p.vendorName}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">PO Number</td><td style="padding: 8px 0; font-weight: 500; color: #111; font-size: 13px; text-align: right;">${p.poNumber}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Total</td><td style="padding: 8px 0; font-weight: 600; color: #111; font-size: 13px; text-align: right;">${formatted}</td></tr>
        </table>
        <a href="${reviewUrl}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Review PO</a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">Synapse3P · <a href="${APP_URL}" style="color: #aaa;">Open platform</a></p>
      </div>
    `,
  })
}

// ---------------------------------------------------------------------------
// PO decision — notify creator
// ---------------------------------------------------------------------------

export interface PODecisionEmailParams {
  to: string
  creatorName: string
  poNumber: string
  vendorName: string
  totalAmount: number
  currency: string
  poId: string
  decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'
  comments?: string
}

export async function sendPODecisionEmail(p: PODecisionEmailParams): Promise<void> {
  const url = `${APP_URL}/dashboard/purchase-orders/${p.poId}`
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency }).format(p.totalAmount)
  const decisionLabel = p.decision === 'APPROVED' ? 'approved' : p.decision === 'REJECTED' ? 'rejected' : 'returned for changes'
  const decisionColor = p.decision === 'APPROVED' ? '#16a34a' : '#dc2626'

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `PO ${p.poNumber} has been ${decisionLabel}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #fff;">
        <div style="font-size: 20px; font-weight: 600; color: ${decisionColor}; margin-bottom: 8px; text-transform: capitalize;">PO ${decisionLabel}</div>
        <p style="color: #555; margin: 0 0 24px;">Hi ${p.creatorName}, your purchase order has been ${decisionLabel}.</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Vendor</td><td style="padding: 8px 0; font-weight: 500; color: #111; font-size: 13px; text-align: right;">${p.vendorName}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">PO Number</td><td style="padding: 8px 0; font-weight: 500; color: #111; font-size: 13px; text-align: right;">${p.poNumber}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Total</td><td style="padding: 8px 0; font-weight: 600; color: #111; font-size: 13px; text-align: right;">${formatted}</td></tr>
          ${p.comments ? `<tr><td style="padding: 8px 0; color: #888; font-size: 13px; vertical-align: top;">Notes</td><td style="padding: 8px 0; font-size: 13px; color: #111; text-align: right;">${p.comments}</td></tr>` : ''}
        </table>
        <a href="${url}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View PO</a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">Synapse3P · <a href="${APP_URL}" style="color: #aaa;">Open platform</a></p>
      </div>
    `,
  })
}

// ---------------------------------------------------------------------------
// Pending invoice reminder
// ---------------------------------------------------------------------------

export interface InvoiceReminderEmailParams {
  to: string
  assigneeName: string
  invoiceNo: string
  vendorName: string
  amount: number
  currency: string
  invoiceId: string
  daysWaiting: number
}

export async function sendInvoiceReminderEmail(p: InvoiceReminderEmailParams): Promise<void> {
  const reviewUrl = `${APP_URL}/dashboard/invoices/${p.invoiceId}/approve`
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency }).format(p.amount)

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `Reminder: Invoice ${p.invoiceNo} has been pending for ${p.daysWaiting} day${p.daysWaiting === 1 ? '' : 's'}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #fff;">
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; font-size: 13px; color: #92400e;">
          ⏰ This invoice has been awaiting your decision for <strong>${p.daysWaiting} day${p.daysWaiting === 1 ? '' : 's'}</strong>.
        </div>
        <div style="font-size: 20px; font-weight: 600; color: #111; margin-bottom: 8px;">Invoice still awaiting approval</div>
        <p style="color: #555; margin: 0 0 24px;">Hi ${p.assigneeName}, a reminder that the following invoice needs your attention.</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Vendor</td><td style="padding: 8px 0; font-weight: 500; color: #111; font-size: 13px; text-align: right;">${p.vendorName}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Invoice #</td><td style="padding: 8px 0; font-weight: 500; color: #111; font-size: 13px; text-align: right;">${p.invoiceNo}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Amount</td><td style="padding: 8px 0; font-weight: 600; color: #111; font-size: 13px; text-align: right;">${formatted}</td></tr>
        </table>
        <a href="${reviewUrl}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Review Invoice</a>
      </div>
    `,
  })
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(params: { to: string; name?: string | null; token: string }): Promise<void> {
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${params.token}`
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: 'Verify your Synapse3P account',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #fff;">
        <div style="font-size: 20px; font-weight: 600; color: #111; margin-bottom: 8px;">Verify your email</div>
        <p style="color: #555; margin: 0 0 24px;">Hi${params.name ? ` ${params.name}` : ''}, click the button below to verify your Synapse3P account.</p>
        <a href="${verifyUrl}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Verify email</a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">If you did not create an account, you can safely ignore this email.</p>
      </div>
    `,
  })
}
