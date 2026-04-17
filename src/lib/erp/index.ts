// Swap MockErpAdapter for NetSuiteRestAdapter by setting NETSUITE_ACCOUNT_ID
// in environment variables. No other code changes required.

import type IErpAdapter from './IErpAdapter'
import { MockErpAdapter } from './MockErpAdapter'
import { NetSuiteRestAdapter } from './NetSuiteRestAdapter'

export function getErpAdapter(): IErpAdapter {
  const accountId = process.env.NETSUITE_ACCOUNT_ID

  if (accountId) {
    return new NetSuiteRestAdapter({
      accountId,
      consumerKey:    process.env.NETSUITE_CONSUMER_KEY!,
      consumerSecret: process.env.NETSUITE_CONSUMER_SECRET!,
      tokenId:        process.env.NETSUITE_TOKEN_ID!,
      tokenSecret:    process.env.NETSUITE_TOKEN_SECRET!,
    })
  }

  return new MockErpAdapter()
}

export type { IErpAdapter }
export * from './types'
