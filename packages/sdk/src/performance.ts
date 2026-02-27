/**
 * Performance optimization utilities for SDK
 */

/**
 * Cache configuration
 */
export interface CacheConfig {
  ttlMs: number // Time to live in milliseconds
  maxEntries?: number // Maximum number of entries
}

/**
 * Cache entry with expiration
 */
interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/**
 * Simple TTL cache
 */
export class TTLCache<K extends string | number, V> {
  private cache = new Map<K, CacheEntry<V>>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(config: CacheConfig) {
    this.ttlMs = config.ttlMs
    this.maxEntries = config.maxEntries ?? 1000

    // Auto-cleanup expired entries every minute
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(() => {
        this.cleanup()
      }, 60000)
    }
  }

  /**
   * Get a value from cache
   */
  get(key: K): V | null {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.value
  }

  /**
   * Set a value in cache
   */
  set(key: K, value: V): void {
    // Remove oldest entry if at max capacity
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number
    maxEntries: number
    ttlMs: number
  } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    }
  }

  /**
   * Destroy cache and cleanup intervals
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.cache.clear()
  }
}

/**
 * Request deduplication - prevents duplicate concurrent requests
 */
export class RequestDeduplicator<K extends string | number, T> {
  private pending = new Map<K, Promise<T>>()

  /**
   * Execute a function, returning cached promise if identical request is in-flight
   */
  async deduplicate(key: K, fn: () => Promise<T>): Promise<T> {
    // Return existing promise if request is already in-flight
    const existing = this.pending.get(key)
    if (existing) {
      return existing
    }

    // Execute and cache the promise
    const promise = fn().finally(() => {
      this.pending.delete(key)
    })

    this.pending.set(key, promise)
    return promise
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    this.pending.clear()
  }

  /**
   * Get number of pending requests
   */
  getPendingCount(): number {
    return this.pending.size
  }
}

/**
 * Memoization decorator for functions
 */
export function memoize<Args extends unknown[], R>(
  fn: (...args: Args) => R | Promise<R>,
  options: {
    ttlMs?: number
    keyGenerator?: (...args: Args) => string
  } = {},
): (...args: Args) => R | Promise<R> {
  const cache = new TTLCache<string, R>({
    ttlMs: options.ttlMs ?? 5 * 60 * 1000, // 5 minutes default
    maxEntries: 1000,
  })

  const keyGenerator = options.keyGenerator ?? ((...args: Args) => JSON.stringify(args))

  return (...args: Args) => {
    const key = keyGenerator(...args)

    // Check cache
    const cached = cache.get(key)
    if (cached !== null) {
      return cached
    }

    // Call function
    const result = fn(...args)

    // Handle async results
    if (result instanceof Promise) {
      return result.then((value) => {
        cache.set(key, value)
        return value
      })
    }

    // Handle sync results
    cache.set(key, result)
    return result
  }
}

/**
 * Batch operations to reduce API calls
 */
export class BatchProcessor<T, R> {
  private batch: T[] = []
  private timer: NodeJS.Timeout | null = null
  private readonly batchSize: number
  private readonly delayMs: number
  private readonly processor: (items: T[]) => Promise<R[]>

  constructor(
    processor: (items: T[]) => Promise<R[]>,
    options: {
      batchSize?: number
      delayMs?: number
    } = {},
  ) {
    this.processor = processor
    this.batchSize = options.batchSize ?? 10
    this.delayMs = options.delayMs ?? 100
  }

  /**
   * Add item to batch
   */
  async add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.batch.push(item)

      // Process immediately if batch is full
      if (this.batch.length >= this.batchSize) {
        this.flush()
          .then((results) => {
            const index = this.batch.indexOf(item)
            resolve(results[index])
          })
          .catch(reject)
        return
      }

      // Schedule processing
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.flush()
            .then((results) => {
              const index = this.batch.indexOf(item)
              resolve(results[index])
            })
            .catch(reject)
        }, this.delayMs)
      }
    })
  }

  /**
   * Process the batch immediately
   */
  async flush(): Promise<R[]> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.batch.length === 0) {
      return []
    }

    const items = this.batch
    this.batch = []

    return this.processor(items)
  }

  /**
   * Get current batch size
   */
  getSize(): number {
    return this.batch.length
  }
}

/**
 * Rate limiter for API calls
 */
export class RateLimiter {
  private lastCallTime = 0
  private readonly minIntervalMs: number

  constructor(maxRequestsPerSecond: number = 100) {
    this.minIntervalMs = 1000 / maxRequestsPerSecond
  }

  /**
   * Wait if necessary to respect rate limit
   */
  async wait(): Promise<void> {
    const now = Date.now()
    const timeSinceLastCall = now - this.lastCallTime
    const delayNeeded = this.minIntervalMs - timeSinceLastCall

    if (delayNeeded > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayNeeded))
    }

    this.lastCallTime = Date.now()
  }

  /**
   * Reset rate limiter
   */
  reset(): void {
    this.lastCallTime = 0
  }
}
