/**
 * Synapse3P — Comprehensive Demo Seed
 *
 * Populates realistic data across all major modules for the acme org.
 * Safe to re-run: uses upsert wherever a unique constraint exists;
 * uses findFirst-then-create for tables without one.
 *
 * Usage: npx tsx scripts/seed-demo.ts
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { prisma } from '@/lib/prisma'
import { seedInvoiceTemplates } from '@/lib/workflow-engine/templates/invoice-templates'
import { seedEntityTemplates } from '@/lib/workflow-engine/templates/entity-templates'
import { seedPOTemplates } from '@/lib/workflow-engine/templates/po-templates'

// ---------------------------------------------------------------------------
// Load .env.local in development
// ---------------------------------------------------------------------------
const envLocalPath = resolve(process.cwd(), '.env.local')
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function daysFromNow(d: number): Date { return new Date(Date.now() + d * 86_400_000) }
function daysAgo(d: number): Date     { return new Date(Date.now() - d * 86_400_000) }
function monthsFromNow(m: number): Date { return daysFromNow(m * 30) }
function monthsAgo(m: number): Date    { return daysAgo(m * 30) }

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------
const summary: Record<string, number> = {}
function tally(key: string, n = 1) { summary[key] = (summary[key] ?? 0) + n }

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  console.log('╔══════════════════════════════════════╗')
  console.log('║   Synapse3P  —  Demo Seed Script     ║')
  console.log('╚══════════════════════════════════════╝\n')

  // ── Locate acme org ─────────────────────────────────────────────────────
  const acme = await prisma.organisation.findUniqueOrThrow({ where: { slug: 'acme' } })
  const orgId = acme.id
  console.log(`✔ Found org: ${acme.name} (${orgId})\n`)

  // ── Admin user id for requestedBy / openedBy fields ─────────────────────
  const adminUser = await prisma.user.findFirst({
    where: { memberships: { some: { orgId, role: 'ADMIN' } } },
    select: { id: true, email: true },
  })
  const adminId = adminUser?.id ?? 'system'
  console.log(`✔ Admin user: ${adminUser?.email ?? 'system'}\n`)

  // ==========================================================================
  // 1. ENTITIES
  // ==========================================================================
  console.log('── 1. Entities ─────────────────────────────────────────────')

  const entityDefs = [
    { name: 'Goldman Sachs Group Inc',        slug: 'goldman-sachs',    jurisdiction: 'US', registrationNo: 'GS-12345', primaryCurrency: 'USD', riskScore: 3.2 },
    { name: 'Clifford Chance LLP',            slug: 'clifford-chance',  jurisdiction: 'GB', registrationNo: 'CC-98765', primaryCurrency: 'GBP', riskScore: 2.1 },
    { name: 'Deloitte & Touche LLP',          slug: 'deloitte',         jurisdiction: 'US', registrationNo: 'DT-54321', primaryCurrency: 'USD', riskScore: 1.8 },
    { name: 'BlackRock Inc',                  slug: 'blackrock',        jurisdiction: 'US', registrationNo: 'BR-11111', primaryCurrency: 'USD', riskScore: 2.5 },
    { name: 'State Street Corporation',       slug: 'state-street',     jurisdiction: 'US', registrationNo: 'SS-22222', primaryCurrency: 'USD', riskScore: 2.8 },
    { name: 'Freshfields Bruckhaus Deringer', slug: 'freshfields',      jurisdiction: 'GB', registrationNo: 'FB-33333', primaryCurrency: 'GBP', riskScore: 1.5 },
    { name: 'PricewaterhouseCoopers LLP',     slug: 'pwc',              jurisdiction: 'US', registrationNo: 'PW-44444', primaryCurrency: 'USD', riskScore: 1.9 },
    { name: 'Apex Fund Services',             slug: 'apex-fund-services', jurisdiction: 'KY', registrationNo: 'AF-55555', primaryCurrency: 'USD', riskScore: 4.1 },
  ]

  const entityMap: Record<string, string> = {} // slug → id

  for (const def of entityDefs) {
    const entity = await prisma.entity.upsert({
      where:  { slug: def.slug },
      update: { name: def.name, riskScore: def.riskScore, primaryCurrency: def.primaryCurrency },
      create: {
        masterOrgId:    orgId,
        name:           def.name,
        slug:           def.slug,
        legalStructure: 'COMPANY',
        jurisdiction:   def.jurisdiction,
        registrationNo: def.registrationNo,
        status:         'ACTIVE',
        primaryCurrency: def.primaryCurrency,
        riskScore:      def.riskScore,
      },
    })
    entityMap[def.slug] = entity.id
    tally('entities')
    console.log(`  ✔ ${def.name}`)
  }

  // ==========================================================================
  // 2. ENTITY CLASSIFICATIONS
  // ==========================================================================
  console.log('\n── 2. Entity Classifications ────────────────────────────────')

  const classificationDefs: Array<{ slug: string; types: string[]; primaryType: string }> = [
    { slug: 'goldman-sachs',    types: ['SERVICE_PROVIDER', 'COUNTERPARTY'],           primaryType: 'SERVICE_PROVIDER' },
    { slug: 'clifford-chance',  types: ['SERVICE_PROVIDER'],                            primaryType: 'SERVICE_PROVIDER' },
    { slug: 'deloitte',         types: ['SERVICE_PROVIDER'],                            primaryType: 'SERVICE_PROVIDER' },
    { slug: 'blackrock',        types: ['PARTNER', 'COUNTERPARTY'],                     primaryType: 'PARTNER'          },
    { slug: 'state-street',     types: ['SERVICE_PROVIDER', 'COUNTERPARTY'],           primaryType: 'SERVICE_PROVIDER' },
    { slug: 'freshfields',      types: ['SERVICE_PROVIDER'],                            primaryType: 'SERVICE_PROVIDER' },
    { slug: 'pwc',              types: ['SERVICE_PROVIDER'],                            primaryType: 'SERVICE_PROVIDER' },
    { slug: 'apex-fund-services', types: ['FUND_SERVICE', 'SERVICE_PROVIDER'],         primaryType: 'FUND_SERVICE'     },
  ]

  for (const def of classificationDefs) {
    const entityId = entityMap[def.slug]
    for (const type of def.types) {
      await prisma.entityClassification.upsert({
        where:  { entityId_type: { entityId, type: type as never } },
        update: { isPrimary: type === def.primaryType },
        create: { entityId, type: type as never, isPrimary: type === def.primaryType, startDate: new Date('2024-01-01') },
      })
      tally('classifications')
    }
    console.log(`  ✔ ${def.slug}: ${def.types.join(', ')}`)
  }

  // ==========================================================================
  // 3. ENTITY BANK ACCOUNTS
  // ==========================================================================
  console.log('\n── 3. Entity Bank Accounts ─────────────────────────────────')

  const bankAccountDefs = [
    { slug: 'goldman-sachs',    label: 'Primary USD — JPMorgan Chase',    accountName: 'Goldman Sachs Group Inc', accountNo: '4001234567', routingNo: '021000021', currency: 'USD', rail: 'ACH',   swiftBic: null,      iban: null },
    { slug: 'clifford-chance',  label: 'Primary GBP — Barclays',          accountName: 'Clifford Chance LLP',     accountNo: '55779911',   routingNo: null,         currency: 'GBP', rail: 'SWIFT', swiftBic: 'BARCGB22', iban: 'GB29BARC20000055779911' },
    { slug: 'deloitte',         label: 'Primary USD — Bank of America',   accountName: 'Deloitte & Touche LLP',   accountNo: '4009876543', routingNo: '026009593', currency: 'USD', rail: 'ACH',   swiftBic: null,      iban: null },
    { slug: 'blackrock',        label: 'Primary USD — JPMorgan Chase',    accountName: 'BlackRock Inc',           accountNo: '4002345678', routingNo: '021000021', currency: 'USD', rail: 'ACH',   swiftBic: null,      iban: null },
    { slug: 'state-street',     label: 'Primary USD — State Street Bank', accountName: 'State Street Corporation', accountNo: '4003456789', routingNo: '011000028', currency: 'USD', rail: 'ACH',  swiftBic: null,      iban: null },
    { slug: 'freshfields',      label: 'Primary GBP — HSBC',              accountName: 'Freshfields Bruckhaus Deringer', accountNo: '12345678', routingNo: null, currency: 'GBP', rail: 'SWIFT', swiftBic: 'HBUKGB4B', iban: 'GB98MIDL40051512345678' },
    { slug: 'pwc',              label: 'Primary USD — Citibank',          accountName: 'PricewaterhouseCoopers LLP', accountNo: '4004567890', routingNo: '021000089', currency: 'USD', rail: 'ACH', swiftBic: null,      iban: null },
    { slug: 'apex-fund-services', label: 'Primary USD — JPMorgan Chase', accountName: 'Apex Fund Services',      accountNo: '4005678901', routingNo: '021000021', currency: 'USD', rail: 'ACH',   swiftBic: null,      iban: null },
  ]

  const bankAccountMap: Record<string, string> = {} // slug → bankAccountId

  for (const def of bankAccountDefs) {
    const entityId = entityMap[def.slug]
    const existing = await prisma.entityBankAccount.findFirst({ where: { entityId, isPrimary: true } })
    if (!existing) {
      const ba = await prisma.entityBankAccount.create({
        data: {
          entityId,
          label:       def.label,
          isPrimary:   true,
          accountName: def.accountName,
          accountNo:   def.accountNo,
          routingNo:   def.routingNo,
          swiftBic:    def.swiftBic,
          iban:        def.iban,
          currency:    def.currency,
          paymentRail: def.rail as never,
          status:      'ACTIVE',
        },
      })
      bankAccountMap[def.slug] = ba.id
      tally('bankAccounts')
      console.log(`  ✔ ${def.slug}: ${def.label}`)
    } else {
      bankAccountMap[def.slug] = existing.id
      console.log(`  ↩ ${def.slug}: already exists`)
    }
  }

  // ==========================================================================
  // 4. ENTITY ORG RELATIONSHIPS
  // ==========================================================================
  console.log('\n── 4. Entity Org Relationships ─────────────────────────────')

  const spendLimits: Record<string, number> = {
    'goldman-sachs':    5_000_000,
    'clifford-chance':  2_000_000,
    'deloitte':         3_000_000,
    'blackrock':        4_000_000,
    'state-street':     3_500_000,
    'freshfields':      1_500_000,
    'pwc':              2_500_000,
    'apex-fund-services': 500_000,
  }

  for (const def of entityDefs) {
    const entityId = entityMap[def.slug]
    await prisma.entityOrgRelationship.upsert({
      where:  { entityId_orgId: { entityId, orgId } },
      update: { onboardingStatus: 'APPROVED', activeForBillPay: true, approvedSpendLimit: spendLimits[def.slug] },
      create: {
        entityId,
        orgId,
        onboardingStatus:      'APPROVED',
        onboardingCompletedAt: new Date('2024-01-15'),
        contractStart:         new Date('2024-01-01'),
        approvedSpendLimit:    spendLimits[def.slug],
        activeForBillPay:      true,
        portalAccess:          false,
      },
    })
    tally('orgRelationships')
    console.log(`  ✔ ${def.slug}: approved, spend limit $${spendLimits[def.slug].toLocaleString()}`)
  }

  // ==========================================================================
  // 5. ENTITY DUE DILIGENCE
  // ==========================================================================
  console.log('\n── 5. Entity Due Diligence ─────────────────────────────────')

  const ddNextReview: Record<string, number> = {
    'goldman-sachs': 6, 'clifford-chance': 12, 'deloitte': 18,
    'blackrock': 9, 'state-street': 6, 'freshfields': 18, 'pwc': 12, 'apex-fund-services': 3,
  }

  for (const def of entityDefs) {
    const entityId = entityMap[def.slug]
    await prisma.entityDueDiligence.upsert({
      where:  { entityId },
      update: { kycStatus: 'APPROVED', kybStatus: 'APPROVED', sanctionsStatus: 'CLEAR' },
      create: {
        entityId,
        ddLevel:        2,
        kycStatus:      'APPROVED',
        kybStatus:      'APPROVED',
        sanctionsStatus: 'CLEAR',
        pepStatus:      false,
        reviewedAt:     daysAgo(30),
        reviewedBy:     adminId,
        nextReviewDate: monthsFromNow(ddNextReview[def.slug]),
      },
    })
    tally('dueDiligence')
    console.log(`  ✔ ${def.slug}: KYC/KYB approved, next review ${ddNextReview[def.slug]}mo`)
  }

  // ==========================================================================
  // 6. SERVICE CATALOGUE
  // ==========================================================================
  console.log('\n── 6. Service Catalogue ────────────────────────────────────')

  const catalogueDefs = [
    { name: 'Fund Administration',    category: 'FUND_ADMIN'   },
    { name: 'Custody Services',       category: 'CUSTODY'      },
    { name: 'Legal Advisory',         category: 'LEGAL'        },
    { name: 'Audit & Assurance',      category: 'AUDIT'        },
    { name: 'Banking Services',       category: 'BANKING'      },
    { name: 'Investment Management',  category: 'OUTSOURCING'  },
    { name: 'Tax Advisory',           category: 'LEGAL'        },
    { name: 'Compliance Consulting',  category: 'COMPLIANCE'   },
  ]

  const catalogueMap: Record<string, string> = {} // name → id

  for (const def of catalogueDefs) {
    let svc = await prisma.serviceCatalogue.findFirst({ where: { name: def.name } })
    if (!svc) {
      svc = await prisma.serviceCatalogue.create({ data: { name: def.name, isActive: true } })
      tally('catalogue')
    }
    catalogueMap[def.name] = svc.id
    console.log(`  ✔ ${def.name}`)
  }

  // ==========================================================================
  // 7. SERVICE ENGAGEMENTS
  // ==========================================================================
  console.log('\n── 7. Service Engagements ──────────────────────────────────')

  const engagementDefs = [
    { slug: 'goldman-sachs',    service: 'Banking Services'      },
    { slug: 'goldman-sachs',    service: 'Custody Services'      },
    { slug: 'clifford-chance',  service: 'Legal Advisory'        },
    { slug: 'freshfields',      service: 'Legal Advisory'        },
    { slug: 'deloitte',         service: 'Audit & Assurance'     },
    { slug: 'pwc',              service: 'Tax Advisory'          },
    { slug: 'blackrock',        service: 'Investment Management' },
    { slug: 'state-street',     service: 'Custody Services'      },
    { slug: 'apex-fund-services', service: 'Fund Administration' },
  ]

  for (const def of engagementDefs) {
    const entityId          = entityMap[def.slug]
    const serviceCatalogueId = catalogueMap[def.service]
    await prisma.serviceEngagement.upsert({
      where:  { entityId_serviceCatalogueId_orgId: { entityId, serviceCatalogueId, orgId } },
      update: { status: 'ACTIVE', slaStatus: 'ON_TRACK' },
      create: {
        entityId,
        serviceCatalogueId,
        orgId,
        status:        'ACTIVE',
        contractStart: new Date('2024-01-01'),
        contractEnd:   new Date('2026-12-31'),
        slaStatus:     'ON_TRACK',
      },
    })
    tally('engagements')
    console.log(`  ✔ ${def.slug} → ${def.service}`)
  }

  // ==========================================================================
  // 8. RECURRING SCHEDULES
  // ==========================================================================
  console.log('\n── 8. Recurring Schedules ──────────────────────────────────')

  const scheduleDefs = [
    { slug: 'goldman-sachs',    name: 'Goldman Sachs — Banking Fees',    amount: 8_500,  currency: 'USD', frequency: 'MONTHLY',   tolerancePct: 0.02, dayOfMonth: 1  },
    { slug: 'state-street',     name: 'State Street — Custody Fees',     amount: 12_000, currency: 'USD', frequency: 'MONTHLY',   tolerancePct: 0.03, dayOfMonth: 5  },
    { slug: 'clifford-chance',  name: 'Clifford Chance — Retainer',      amount: 15_000, currency: 'GBP', frequency: 'MONTHLY',   tolerancePct: 0.00, dayOfMonth: 1  },
    { slug: 'deloitte',         name: 'Deloitte — Audit Fee',            amount: 95_000, currency: 'USD', frequency: 'QUARTERLY', tolerancePct: 0.00, dayOfMonth: null },
    { slug: 'apex-fund-services', name: 'Apex Fund Services — Admin Fee', amount: 22_000, currency: 'USD', frequency: 'MONTHLY',   tolerancePct: 0.05, dayOfMonth: 15 },
  ]

  const scheduleMap: Record<string, string> = {} // name → id

  for (const def of scheduleDefs) {
    const entityId = entityMap[def.slug]
    const existing = await prisma.recurringSchedule.findFirst({ where: { entityId, name: def.name } })
    if (!existing) {
      const sched = await prisma.recurringSchedule.create({
        data: {
          orgId,
          entityId,
          name:         def.name,
          expectedAmount: def.amount,
          currency:     def.currency,
          frequency:    def.frequency,
          dayOfMonth:   def.dayOfMonth,
          tolerancePct: def.tolerancePct,
          isActive:     true,
        },
      })
      scheduleMap[def.name] = sched.id
      tally('schedules')
      console.log(`  ✔ ${def.name}  (${def.currency} ${def.amount.toLocaleString()} ${def.frequency})`)
    } else {
      scheduleMap[def.name] = existing.id
      console.log(`  ↩ ${def.name}: already exists`)
    }
  }

  // ==========================================================================
  // 9. INVOICES
  // ==========================================================================
  console.log('\n── 9. Invoices ─────────────────────────────────────────────')

  const gsId   = entityMap['goldman-sachs']
  const ssId   = entityMap['state-street']
  const ccId   = entityMap['clifford-chance']
  const dtId   = entityMap['deloitte']
  const pwcId  = entityMap['pwc']
  const afId   = entityMap['apex-fund-services']

  const gsBankSched  = scheduleMap['Goldman Sachs — Banking Fees']
  const ssCustSched  = scheduleMap['State Street — Custody Fees']
  const ccRetSched   = scheduleMap['Clifford Chance — Retainer']
  const dtAuditSched = scheduleMap['Deloitte — Audit Fee']
  const afAdminSched = scheduleMap['Apex Fund Services — Admin Fee']

  const invoiceDefs = [
    // PAID (4)
    {
      invoiceNo: 'INV-GS-2026-001', entityId: gsId, amount: 8_500,  currency: 'USD',
      invoiceDate: daysAgo(60), dueDate: daysAgo(30), status: 'PAID',
      scheduleId: gsBankSched,  notes: 'Goldman Sachs banking fees — January 2026',
    },
    {
      invoiceNo: 'INV-GS-2026-002', entityId: gsId, amount: 8_500,  currency: 'USD',
      invoiceDate: daysAgo(30), dueDate: daysAgo(5), status: 'PAID',
      scheduleId: gsBankSched,  notes: 'Goldman Sachs banking fees — February 2026',
    },
    {
      invoiceNo: 'INV-SS-2026-001', entityId: ssId, amount: 12_000, currency: 'USD',
      invoiceDate: daysAgo(55), dueDate: daysAgo(25), status: 'PAID',
      scheduleId: ssCustSched,  notes: 'State Street custody fees — January 2026',
    },
    {
      invoiceNo: 'INV-CC-2026-001', entityId: ccId, amount: 15_000, currency: 'GBP',
      invoiceDate: daysAgo(50), dueDate: daysAgo(20), status: 'PAID',
      scheduleId: ccRetSched,   notes: 'Clifford Chance retainer — January 2026',
    },
    // APPROVED (3)
    {
      invoiceNo: 'INV-GS-2026-003', entityId: gsId, amount: 8_500,  currency: 'USD',
      invoiceDate: daysAgo(5),  dueDate: daysFromNow(15), status: 'APPROVED',
      scheduleId: gsBankSched,  notes: 'Goldman Sachs banking fees — March 2026',
    },
    {
      invoiceNo: 'INV-SS-2026-002', entityId: ssId, amount: 12_000, currency: 'USD',
      invoiceDate: daysAgo(8),  dueDate: daysFromNow(10), status: 'APPROVED',
      scheduleId: ssCustSched,  notes: 'State Street custody fees — February 2026',
    },
    {
      invoiceNo: 'INV-AF-2026-001', entityId: afId, amount: 22_000, currency: 'USD',
      invoiceDate: daysAgo(3),  dueDate: daysFromNow(25), status: 'APPROVED',
      scheduleId: afAdminSched, notes: 'Apex Fund Services admin fee — January 2026',
    },
    // PENDING_REVIEW (2) — flagged by risk engine
    {
      invoiceNo: 'INV-DT-2026-001', entityId: dtId, amount: 95_000, currency: 'USD',
      invoiceDate: daysAgo(7),  dueDate: daysFromNow(23), status: 'PENDING_REVIEW',
      scheduleId: dtAuditSched, notes: 'Deloitte audit fee Q1 2026 — flagged: first quarterly instalment',
    },
    {
      invoiceNo: 'INV-PW-2026-001', entityId: pwcId, amount: 45_000, currency: 'USD',
      invoiceDate: daysAgo(4),  dueDate: daysFromNow(26), status: 'PENDING_REVIEW',
      scheduleId: null,         notes: 'PwC tax advisory — flagged: no matching PO on file',
    },
    // RECEIVED (2) — just arrived
    {
      invoiceNo: 'INV-CC-2026-002', entityId: ccId, amount: 15_000, currency: 'GBP',
      invoiceDate: daysAgo(1),  dueDate: daysFromNow(29), status: 'RECEIVED',
      scheduleId: ccRetSched,   notes: 'Clifford Chance retainer — February 2026',
    },
    {
      invoiceNo: 'INV-SS-2026-003', entityId: ssId, amount: 12_150, currency: 'USD',
      invoiceDate: daysAgo(1),  dueDate: daysFromNow(29), status: 'RECEIVED',
      scheduleId: ssCustSched,  notes: 'State Street custody fees — March 2026 (slight variance)',
    },
    // OVERDUE (1) — approved but past due
    {
      invoiceNo: 'INV-GS-2026-CUST-001', entityId: gsId, amount: 18_500, currency: 'USD',
      invoiceDate: daysAgo(45), dueDate: daysAgo(15),    status: 'APPROVED',
      scheduleId: null,         notes: 'Goldman Sachs custody fee — overdue, awaiting payment authorisation',
    },
  ]

  for (const def of invoiceDefs) {
    await prisma.invoice.upsert({
      where:  { orgId_invoiceNo: { orgId, invoiceNo: def.invoiceNo } },
      update: { status: def.status as never, notes: def.notes },
      create: {
        orgId,
        invoiceNo:          def.invoiceNo,
        entityId:           def.entityId,
        recurringScheduleId: def.scheduleId,
        amount:             def.amount,
        currency:           def.currency,
        invoiceDate:        def.invoiceDate,
        dueDate:            def.dueDate,
        status:             def.status as never,
        source:             'MANUAL',
        isRecurring:        def.scheduleId !== null,
        matchType:          'NONE',
        notes:              def.notes,
      },
    })
    tally('invoices')
    console.log(`  ✔ ${def.invoiceNo}  ${def.currency} ${def.amount.toLocaleString()}  [${def.status}]`)
  }

  // ==========================================================================
  // 10. PURCHASE ORDERS
  // ==========================================================================
  console.log('\n── 10. Purchase Orders ─────────────────────────────────────')

  const poDefs = [
    {
      poNumber: 'PO-2026-GS-001',
      title:    'Goldman Sachs — Banking Services Setup',
      entitySlug: 'goldman-sachs',
      type:     'FIXED',  track: 'FULL_PO',
      totalAmount: 50_000, currency: 'USD',
      lineItems: [{ lineNo: 1, description: 'Banking services onboarding & setup', quantity: 1, unitPrice: 50_000, totalPrice: 50_000 }],
    },
    {
      poNumber: 'PO-2026-CC-001',
      title:    'Clifford Chance — Legal Project Retainer',
      entitySlug: 'clifford-chance',
      type:     'FIXED', track: 'FULL_PO',
      totalAmount: 75_000, currency: 'GBP',
      lineItems: [{ lineNo: 1, description: 'Legal advisory services — transaction support', quantity: 1, unitPrice: 75_000, totalPrice: 75_000 }],
    },
    {
      poNumber: 'PO-2026-MISC-001',
      title:    'Office Supplies — Q1 2026',
      entitySlug: 'goldman-sachs',
      type:     'FIXED', track: 'STP',
      totalAmount: 2_500, currency: 'USD',
      lineItems: [{ lineNo: 1, description: 'Office stationery and consumables', quantity: 50, unitPrice: 50, totalPrice: 2_500 }],
    },
    {
      poNumber: 'PO-2026-DT-001',
      title:    'Deloitte — IT Consulting Blanket Order',
      entitySlug: 'deloitte',
      type:     'BLANKET', track: 'FULL_PO',
      totalAmount: 180_000, currency: 'USD',
      validFrom: new Date('2026-01-01'), validTo: new Date('2026-12-31'),
      lineItems: [
        { lineNo: 1, description: 'IT systems review and advisory', quantity: 1, unitPrice: 120_000, totalPrice: 120_000 },
        { lineNo: 2, description: 'Data governance consulting',      quantity: 1, unitPrice: 60_000,  totalPrice: 60_000  },
      ],
    },
  ]

  for (const def of poDefs) {
    const entityId = entityMap[def.entitySlug]
    const po = await prisma.purchaseOrder.upsert({
      where:  { orgId_poNumber: { orgId, poNumber: def.poNumber } },
      update: { status: 'APPROVED', totalAmount: def.totalAmount },
      create: {
        orgId,
        poNumber:    def.poNumber,
        title:       def.title,
        description: def.title,
        type:        def.type as never,
        track:       def.track as never,
        status:      'APPROVED',
        entityId,
        totalAmount: def.totalAmount,
        currency:    def.currency,
        requestedBy: adminId,
        validFrom:   (def as { validFrom?: Date }).validFrom,
        validTo:     (def as { validTo?: Date }).validTo,
      },
    })
    tally('purchaseOrders')

    // Line items — only create if none exist yet
    const existingLines = await prisma.pOLineItem.findFirst({ where: { poId: po.id } })
    if (!existingLines) {
      for (const li of def.lineItems) {
        await prisma.pOLineItem.create({
          data: { poId: po.id, ...li, currency: def.currency },
        })
        tally('poLineItems')
      }
    }
    console.log(`  ✔ ${def.poNumber}: ${def.currency} ${def.totalAmount.toLocaleString()} [${def.type}/${def.track}]`)
  }

  // ==========================================================================
  // 11. THIRD PARTY REVIEWS
  // ==========================================================================
  console.log('\n── 11. Third Party Reviews ─────────────────────────────────')

  const reviewDefs: Array<{
    slug: string
    cyberScore: number
    legalScore: number
    privacyScore: number
    completedMonthsAgo: number
    nextReviewMonths: number
  }> = [
    { slug: 'goldman-sachs',    cyberScore: 8.2, legalScore: 8.5, privacyScore: 7.9, completedMonthsAgo: 3,  nextReviewMonths: 9  },
    { slug: 'clifford-chance',  cyberScore: 7.5, legalScore: 9.5, privacyScore: 8.8, completedMonthsAgo: 6,  nextReviewMonths: 18 },
    { slug: 'deloitte',         cyberScore: 8.8, legalScore: 9.2, privacyScore: 8.5, completedMonthsAgo: 12, nextReviewMonths: 6  },
    { slug: 'blackrock',        cyberScore: 8.5, legalScore: 8.0, privacyScore: 7.5, completedMonthsAgo: 9,  nextReviewMonths: 9  },
    { slug: 'state-street',     cyberScore: 8.0, legalScore: 8.5, privacyScore: 7.8, completedMonthsAgo: 6,  nextReviewMonths: 12 },
    { slug: 'freshfields',      cyberScore: 7.0, legalScore: 9.5, privacyScore: 8.2, completedMonthsAgo: 12, nextReviewMonths: 6  },
    { slug: 'pwc',              cyberScore: 9.2, legalScore: 8.8, privacyScore: 9.0, completedMonthsAgo: 3,  nextReviewMonths: 15 },
    { slug: 'apex-fund-services', cyberScore: 6.5, legalScore: 7.0, privacyScore: 6.8, completedMonthsAgo: 4, nextReviewMonths: 8 },
  ]

  for (const def of reviewDefs) {
    const entityId    = entityMap[def.slug]
    const overallScore = parseFloat(((def.cyberScore + def.legalScore + def.privacyScore) / 3).toFixed(2))

    const existing = await prisma.thirdPartyReview.findFirst({
      where: { entityId, orgId, reviewType: 'ONBOARDING' },
    })
    if (!existing) {
      await prisma.thirdPartyReview.create({
        data: {
          entityId,
          orgId,
          reviewType:    'ONBOARDING',
          status:        'COMPLETED',
          cyberScore:    def.cyberScore,
          legalScore:    def.legalScore,
          privacyScore:  def.privacyScore,
          overallScore,
          reviewedBy:    adminId,
          completedAt:   monthsAgo(def.completedMonthsAgo),
          nextReviewDate: monthsFromNow(def.nextReviewMonths),
        },
      })
      tally('thirdPartyReviews')
      console.log(`  ✔ ${def.slug}: overall ${overallScore} (cyber ${def.cyberScore}, legal ${def.legalScore}, privacy ${def.privacyScore})`)
    } else {
      console.log(`  ↩ ${def.slug}: review already exists`)
    }
  }

  // ==========================================================================
  // 12. ENTITY RISK SCORES
  // ==========================================================================
  console.log('\n── 12. Entity Risk Scores ──────────────────────────────────')

  const riskScoreDefs: Array<{
    slug: string; computedScore: number; ddScore: number; behaviorScore: number
  }> = [
    { slug: 'goldman-sachs',    computedScore: 3.2, ddScore: 8.2, behaviorScore: 7.8 },
    { slug: 'clifford-chance',  computedScore: 2.1, ddScore: 9.0, behaviorScore: 8.5 },
    { slug: 'deloitte',         computedScore: 1.8, ddScore: 9.0, behaviorScore: 9.0 },
    { slug: 'blackrock',        computedScore: 2.5, ddScore: 8.5, behaviorScore: 7.8 },
    { slug: 'state-street',     computedScore: 2.8, ddScore: 8.0, behaviorScore: 7.5 },
    { slug: 'freshfields',      computedScore: 1.5, ddScore: 9.0, behaviorScore: 9.2 },
    { slug: 'pwc',              computedScore: 1.9, ddScore: 8.8, behaviorScore: 9.0 },
    { slug: 'apex-fund-services', computedScore: 4.1, ddScore: 7.5, behaviorScore: 6.0 },
  ]

  const weights = { dd: 0.3, behavior: 0.4, sanctions: 0.3 }

  for (const def of riskScoreDefs) {
    const entityId = entityMap[def.slug]
    const existing = await prisma.entityRiskScore.findFirst({ where: { entityId } })
    if (!existing) {
      await prisma.entityRiskScore.create({
        data: {
          entityId,
          computedScore:  def.computedScore,
          ddScore:        def.ddScore,
          behaviorScore:  def.behaviorScore,
          sanctionsScore: 9.5,
          weights,
          scoredAt:       daysAgo(30),
          scoredBy:       'system',
        },
      })
      tally('riskScores')
      console.log(`  ✔ ${def.slug}: ${def.computedScore} (dd ${def.ddScore}, behavior ${def.behaviorScore}, sanctions 9.5)`)
    } else {
      console.log(`  ↩ ${def.slug}: risk score already exists`)
    }
  }

  // ==========================================================================
  // WORKFLOW TEMPLATES
  // ==========================================================================
  console.log('\n── Workflow Templates ──────────────────────────────────────')

  await Promise.all([
    seedInvoiceTemplates(orgId, adminId, prisma),
    seedEntityTemplates(orgId, adminId, prisma),
    seedPOTemplates(orgId, adminId, prisma),
  ]).catch(err => console.warn('[WorkflowEngine] Failed to seed templates:', err))

  console.log('  ✔ Workflow templates seeded (idempotent)')

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║          Demo Seed Complete          ║')
  console.log('╠══════════════════════════════════════╣')
  const rows = [
    ['Entities',              summary.entities             ?? 0],
    ['Classifications',       summary.classifications      ?? 0],
    ['Bank Accounts',         summary.bankAccounts         ?? 0],
    ['Org Relationships',     summary.orgRelationships     ?? 0],
    ['Due Diligence records', summary.dueDiligence         ?? 0],
    ['Service Catalogue',     summary.catalogue            ?? 0],
    ['Service Engagements',   summary.engagements          ?? 0],
    ['Recurring Schedules',   summary.schedules            ?? 0],
    ['Invoices',              summary.invoices             ?? 0],
    ['Purchase Orders',       summary.purchaseOrders       ?? 0],
    ['PO Line Items',         summary.poLineItems          ?? 0],
    ['Third Party Reviews',   summary.thirdPartyReviews    ?? 0],
    ['Risk Scores',           summary.riskScores           ?? 0],
  ] as Array<[string, number]>

  const total = rows.reduce((sum, [, n]) => sum + n, 0)
  for (const [label, count] of rows) {
    console.log(`║  ${label.padEnd(24)} ${String(count).padStart(4)}  ║`)
  }
  console.log('╠══════════════════════════════════════╣')
  console.log(`║  ${'Total records'.padEnd(24)} ${String(total).padStart(4)}  ║`)
  console.log('╚══════════════════════════════════════╝')
}

main()
  .catch(e => { console.error('\n✖ Seed failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
