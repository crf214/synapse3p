interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

interface WindowEntry {
  count: number
  resetAt: Date
}

export class RateLimiter {
  private readonly windows = new Map<string, WindowEntry>()

  constructor(private readonly config: RateLimitConfig) {}

  check(identifier: string): { allowed: boolean; remaining: number; resetAt: Date } {
    const now = Date.now()
    this.cleanup(now)

    const existing = this.windows.get(identifier)

    if (!existing || existing.resetAt.getTime() <= now) {
      const resetAt = new Date(now + this.config.windowMs)
      this.windows.set(identifier, { count: 1, resetAt })
      return { allowed: true, remaining: this.config.maxRequests - 1, resetAt }
    }

    if (existing.count >= this.config.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt }
    }

    existing.count++
    return {
      allowed:   true,
      remaining: this.config.maxRequests - existing.count,
      resetAt:   existing.resetAt,
    }
  }

  private cleanup(now: number): void {
    // Only scan if the map has grown large enough to warrant it
    if (this.windows.size < 1000) return
    for (const [key, entry] of this.windows) {
      if (entry.resetAt.getTime() <= now) this.windows.delete(key)
    }
  }
}

// Pre-configured limiters
export const authLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 })
export const apiLimiter  = new RateLimiter({ windowMs:       60 * 1000, maxRequests: 100 })
export const erpLimiter  = new RateLimiter({ windowMs:       60 * 1000, maxRequests: 10 })
