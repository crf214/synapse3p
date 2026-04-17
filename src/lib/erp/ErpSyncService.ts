import { prisma } from '@/lib/prisma'
import { getErpAdapter } from './index'
import type { ErpSyncResult, NetSuiteTransaction } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function transactionChanged(
  existing: {
    transactionDate: Date
    amount: number
    currency: string
    vendorRef: string | null
    paymentReference: string | null
    period: string
    periodClosed: boolean
  },
  incoming: NetSuiteTransaction,
): boolean {
  return (
    existing.transactionDate.getTime() !== incoming.transactionDate.getTime() ||
    existing.amount                    !== incoming.amount                    ||
    existing.currency                  !== incoming.currency                  ||
    existing.vendorRef                 !== (incoming.vendorRef    ?? null)    ||
    existing.paymentReference          !== (incoming.paymentReference ?? null)||
    existing.period                    !== incoming.period                    ||
    existing.periodClosed              !== incoming.periodClosed
  )
}

// Find the Entity whose metadata.erpVendorId matches the given ERP id.
async function findEntityByErpId(orgId: string, erpVendorId: string) {
  return prisma.entity.findFirst({
    where: {
      masterOrgId: orgId,
      metadata: { path: ['erpVendorId'], equals: erpVendorId },
    },
  })
}

// ---------------------------------------------------------------------------
// 1. syncVendors
// ---------------------------------------------------------------------------

export async function syncVendors(
  orgId: string,
  triggeredBy: string,
): Promise<{ synced: number; created: number; updated: number; errors: string[] }> {
  const adapter = getErpAdapter()
  const vendors = await adapter.getVendors()

  let created = 0
  let updated = 0
  const errors: string[] = []

  for (const vendor of vendors) {
    try {
      const existing = await findEntityByErpId(orgId, vendor.erpId)

      if (existing) {
        // Detect changes
        const statusChanged = existing.status !== (vendor.isActive ? 'ACTIVE' : 'INACTIVE')
        const nameChanged   = existing.name !== vendor.name
        const currencyChanged = existing.primaryCurrency !== vendor.currency

        if (statusChanged || nameChanged || currencyChanged) {
          const newStatus = vendor.isActive ? 'ACTIVE' : 'INACTIVE'

          await prisma.entity.update({
            where: { id: existing.id },
            data: {
              name:            vendor.name,
              primaryCurrency: vendor.currency,
              status:          newStatus,
            },
          })

          if (statusChanged) {
            await prisma.entityActivityLog.create({
              data: {
                entityId:      existing.id,
                orgId,
                activityType:  'STATUS_CHANGE',
                title:         `Vendor status changed to ${newStatus} via ERP sync`,
                description:   `Previous status: ${existing.status}`,
                referenceType: 'ErpSync',
                performedBy:   triggeredBy,
              },
            })
          }

          updated++
        }
      } else {
        // Create new Entity
        const entity = await prisma.entity.create({
          data: {
            masterOrgId:     orgId,
            name:            vendor.name,
            slug:            `${vendor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${vendor.erpId}`,
            legalStructure:  'COMPANY',
            status:          vendor.isActive ? 'ACTIVE' : 'INACTIVE',
            primaryCurrency: vendor.currency,
            metadata:        { erpVendorId: vendor.erpId },
          },
        })

        await prisma.entityClassification.upsert({
          where:  { entityId_type: { entityId: entity.id, type: 'VENDOR' } },
          update: {},
          create: {
            entityId:  entity.id,
            type:      'VENDOR',
            isPrimary: true,
            startDate: new Date(),
          },
        })

        created++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`[vendor ${vendor.erpId}] ${msg}`)
    }
  }

  return { synced: vendors.length, created, updated, errors }
}

// ---------------------------------------------------------------------------
// 2. syncTransactions
// ---------------------------------------------------------------------------

export async function syncTransactions(
  orgId: string,
  triggeredBy: string,
  since?: Date,
): Promise<ErpSyncResult> {
  const adapter = getErpAdapter()
  const transactions = await adapter.getTransactions(since)

  let transactionsChanged = 0
  let thirdPartyRelevant  = 0
  let newTransactions     = 0
  const errors: Array<{ erpId: string; error: string }> = []

  for (const tx of transactions) {
    try {
      const existing = await prisma.erpTransaction.findUnique({
        where: { orgId_erpInternalId: { orgId, erpInternalId: tx.erpId } },
      })

      // Resolve entity via vendorRef (erpVendorId in metadata)
      const entity = tx.vendorRef ? await findEntityByErpId(orgId, tx.vendorRef) : null
      if (entity) thirdPartyRelevant++

      if (existing) {
        if (transactionChanged(existing, tx)) {
          // Snapshot previous values
          await prisma.erpTransactionVersion.create({
            data: {
              erpTransactionId:           existing.id,
              versionNo:                  existing.currentVersionNo + 1,
              transactionDate:            tx.transactionDate,
              amount:                     tx.amount,
              currency:                   tx.currency,
              vendorRef:                  tx.vendorRef ?? null,
              paymentReference:           tx.paymentReference ?? null,
              period:                     tx.period,
              periodClosed:               tx.periodClosed,
              previousValues: {
                transactionDate:  existing.transactionDate,
                amount:           existing.amount,
                currency:         existing.currency,
                vendorRef:        existing.vendorRef,
                paymentReference: existing.paymentReference,
                period:           existing.period,
                periodClosed:     existing.periodClosed,
              },
              periodWasClosedAtDetection: existing.periodClosed,
            },
          })

          await prisma.erpTransaction.update({
            where: { id: existing.id },
            data: {
              transactionDate:  tx.transactionDate,
              amount:           tx.amount,
              currency:         tx.currency,
              vendorRef:        tx.vendorRef ?? null,
              paymentReference: tx.paymentReference ?? null,
              period:           tx.period,
              periodClosed:     tx.periodClosed,
              currentVersionNo: existing.currentVersionNo + 1,
              lastSyncedAt:     new Date(),
            },
          })

          transactionsChanged++
        }
      } else {
        const created = await prisma.erpTransaction.create({
          data: {
            orgId,
            erpInternalId:    tx.erpId,
            erpTransactionType: tx.type,
            transactionDate:  tx.transactionDate,
            amount:           tx.amount,
            currency:         tx.currency,
            vendorRef:        tx.vendorRef ?? null,
            paymentReference: tx.paymentReference ?? null,
            period:           tx.period,
            periodClosed:     tx.periodClosed,
            entityId:         entity?.id ?? '',
            currentVersionNo: 1,
            lastSyncedAt:     new Date(),
          },
        })

        if (entity) {
          await prisma.entityActivityLog.create({
            data: {
              entityId:      entity.id,
              orgId,
              activityType:  'PAYMENT',
              title:         `ERP transaction synced: ${tx.type} ${tx.erpId} — ${tx.currency} ${tx.amount.toFixed(2)}`,
              referenceId:   created.id,
              referenceType: 'ErpTransaction',
              performedBy:   triggeredBy,
              metadata:      { erpId: tx.erpId, period: tx.period, amount: tx.amount },
            },
          })
        }

        newTransactions++
      }
    } catch (err) {
      errors.push({ erpId: tx.erpId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    transactionsChecked: transactions.length,
    transactionsChanged,
    thirdPartyRelevant,
    newTransactions,
    errors,
  }
}

// ---------------------------------------------------------------------------
// 3. syncPeriods
// ---------------------------------------------------------------------------

export async function syncPeriods(
  orgId: string,
  _triggeredBy: string,
): Promise<{ periods: number; newlyClosed: number }> {
  const adapter = getErpAdapter()
  const periods = await adapter.getPeriods()

  let newlyClosed = 0

  for (const p of periods) {
    const existing = await prisma.erpPeriod.findUnique({
      where: { orgId_period: { orgId, period: p.period } },
    })

    const wasOpen = existing?.isOpen ?? true
    const nowClosed = !p.isOpen

    await prisma.erpPeriod.upsert({
      where:  { orgId_period: { orgId, period: p.period } },
      update: {
        isOpen:   p.isOpen,
        closedAt: p.closedAt ?? null,
      },
      create: {
        orgId,
        period:    p.period,
        startDate: new Date(`${p.period}-01`),
        endDate:   new Date(new Date(`${p.period}-01`).setUTCMonth(new Date(`${p.period}-01`).getUTCMonth() + 1) - 1),
        isOpen:    p.isOpen,
        closedAt:  p.closedAt ?? null,
      },
    })

    // Period just closed — backfill periodClosed on all transactions
    if (wasOpen && nowClosed) {
      await prisma.erpTransaction.updateMany({
        where: { orgId, period: p.period },
        data:  { periodClosed: true },
      })
      newlyClosed++
    }
  }

  return { periods: periods.length, newlyClosed }
}

// ---------------------------------------------------------------------------
// 4. runFullSync
// ---------------------------------------------------------------------------

export async function runFullSync(orgId: string, triggeredBy: string): Promise<void> {
  const syncLog = await prisma.erpSyncLog.create({
    data: {
      orgId,
      trigger:     'MANUAL',
      triggeredBy,
      status:      'IN_PROGRESS',
      startedAt:   new Date(),
    },
  })

  const startMs  = Date.now()
  const allErrors: Array<{ erpId: string; error: string }> = []
  let txResult: ErpSyncResult = { transactionsChecked: 0, transactionsChanged: 0, thirdPartyRelevant: 0, newTransactions: 0, errors: [] }
  let finalStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' = 'SUCCESS'

  try {
    await syncPeriods(orgId, triggeredBy)
  } catch (err) {
    finalStatus = 'PARTIAL'
    allErrors.push({ erpId: 'syncPeriods', error: err instanceof Error ? err.message : String(err) })
  }

  try {
    const vendorResult = await syncVendors(orgId, triggeredBy)
    vendorResult.errors.forEach(e => allErrors.push({ erpId: 'syncVendors', error: e }))
    if (vendorResult.errors.length > 0) finalStatus = 'PARTIAL'
  } catch (err) {
    finalStatus = 'PARTIAL'
    allErrors.push({ erpId: 'syncVendors', error: err instanceof Error ? err.message : String(err) })
  }

  try {
    txResult = await syncTransactions(orgId, triggeredBy)
    if (txResult.errors.length > 0) {
      allErrors.push(...txResult.errors)
      finalStatus = 'PARTIAL'
    }
  } catch (err) {
    finalStatus = allErrors.length === 3 ? 'FAILED' : 'PARTIAL'
    allErrors.push({ erpId: 'syncTransactions', error: err instanceof Error ? err.message : String(err) })
  }

  await prisma.erpSyncLog.update({
    where: { id: syncLog.id },
    data: {
      status:               finalStatus,
      completedAt:          new Date(),
      durationMs:           Date.now() - startMs,
      transactionsChecked:  txResult.transactionsChecked,
      transactionsChanged:  txResult.transactionsChanged,
      thirdPartyRelevant:   txResult.thirdPartyRelevant,
      newTransactions:      txResult.newTransactions,
      errors:               allErrors,
    },
  })
}
