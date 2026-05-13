// src/lib/crypto/field-encryption.ts
// Symmetric field-level encryption for sensitive database columns.
//
// Algorithm : AES-256-CBC (Node crypto built-in, no external deps)
// Key source : FIELD_ENCRYPTION_KEY env var — 64-character hex string (32 bytes)
// Wire format: "enc:<iv_hex>:<ciphertext_hex>"
//
// TODO (pre-prod backfill): existing rows without the "enc:" prefix are returned
// as plaintext. Before going live with real banking data, run the backfill script
// (scripts/backfill-encrypt-bank-accounts.ts, to be created) to encrypt all
// existing accountNo, routingNo, iban, and swiftBic values in entity_bank_accounts.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const IV_BYTES   = 16
const PREFIX     = 'enc:'

function getKey(): Buffer {
  const hex = process.env.FIELD_ENCRYPTION_KEY ?? ''
  if (!hex) {
    throw new Error('FIELD_ENCRYPTION_KEY is not set — cannot encrypt/decrypt field values')
  }
  if (hex.length !== 64) {
    throw new Error('FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Encrypt a plaintext string. Returns "enc:<iv_hex>:<ciphertext_hex>".
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv  = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${PREFIX}${iv.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypt a ciphertext produced by encrypt(). Returns the original plaintext.
 * Throws if the format is unrecognised or decryption fails.
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(PREFIX)) {
    throw new Error('decrypt: value does not have the enc: prefix')
  }
  const rest   = ciphertext.slice(PREFIX.length)
  const colon  = rest.indexOf(':')
  if (colon === -1) throw new Error('decrypt: malformed ciphertext — missing IV separator')

  const iv          = Buffer.from(rest.slice(0, colon), 'hex')
  const encrypted   = Buffer.from(rest.slice(colon + 1), 'hex')
  const key         = getKey()
  const decipher    = createDecipheriv(ALGORITHM, key, iv)
  const decrypted   = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

/**
 * Returns true when the value was produced by encrypt() and needs decryption
 * before being returned to a caller. Backward-compatible: plain values return false.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}
