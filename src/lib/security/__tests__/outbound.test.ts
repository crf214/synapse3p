import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { safeExternalFetch, addAllowedDomain } from '../outbound'
import { ForbiddenError } from '@/lib/errors'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk(): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response('{}', { status: 200 })
  ))
}

function mockFetchHang(): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(
    (_url: string, opts?: RequestInit) =>
      new Promise((_resolve, reject) => {
        // Honour the AbortSignal so the timeout path fires
        const signal = opts?.signal as AbortSignal | undefined
        if (signal) {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
          )
        }
        // Never resolves otherwise
      })
  ))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('safeExternalFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allows requests to allowlisted https domains', async () => {
    mockFetchOk()
    await expect(
      safeExternalFetch('https://api.frankfurter.app/latest')
    ).resolves.toBeInstanceOf(Response)
  })

  it('blocks requests to non-allowlisted domains', async () => {
    await expect(
      safeExternalFetch('https://evil.com/steal')
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ForbiddenError && e.message.includes('not permitted')
    )
  })

  it('blocks http:// requests', async () => {
    await expect(
      safeExternalFetch('http://api.frankfurter.app/latest')
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ForbiddenError && e.message.includes('HTTPS')
    )
  })

  it('blocks localhost', async () => {
    await expect(
      safeExternalFetch('https://localhost/admin')
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ForbiddenError && e.message.includes('private network')
    )
  })

  it('blocks 127.0.0.1', async () => {
    await expect(
      safeExternalFetch('https://127.0.0.1/steal')
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('blocks 192.168.x.x', async () => {
    await expect(
      safeExternalFetch('https://192.168.1.1/internal')
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ForbiddenError && e.message.includes('private network')
    )
  })

  it('blocks 10.x.x.x', async () => {
    await expect(
      safeExternalFetch('https://10.0.0.1/internal')
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ForbiddenError && e.message.includes('private network')
    )
  })

  it('blocks 172.16.x.x', async () => {
    await expect(
      safeExternalFetch('https://172.16.0.1/internal')
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ForbiddenError && e.message.includes('private network')
    )
  })

  it('does not log query parameters (no API key leakage)', async () => {
    mockFetchOk()
    const spy = vi.spyOn(console, 'info')

    await safeExternalFetch('https://api.frankfurter.app/latest?apikey=secret123')

    expect(spy).toHaveBeenCalled()
    const logged = JSON.stringify(spy.mock.calls[0])
    expect(logged).not.toContain('secret123')
    expect(logged).not.toContain('apikey')
  })

  it('throws on timeout', async () => {
    mockFetchHang()

    await expect(
      safeExternalFetch('https://api.frankfurter.app/latest')
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        (e.message.toLowerCase().includes('timeout') ||
         e.message.toLowerCase().includes('aborted') ||
         e.name === 'AbortError')
    )
  }, 15_000)
})

describe('addAllowedDomain', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds a new domain to the allowlist', async () => {
    mockFetchOk()
    addAllowedDomain('new-vendor.api.com')
    await expect(
      safeExternalFetch('https://new-vendor.api.com/data')
    ).resolves.toBeInstanceOf(Response)
  })

  it('is idempotent — adding same domain twice does not cause errors', () => {
    expect(() => {
      addAllowedDomain('duplicate.api.com')
      addAllowedDomain('duplicate.api.com')
    }).not.toThrow()
  })
})
