/**
 * Config-Driven Error Rules & Model-Level Rate Limiting
 * (Borrowed from 9Router Pattern)
 *
 * Instead of hardcoded if/else for 429 errors, uses declarative error rules.
 * Tracks per-model rate limit state with exponential backoff.
 * Prevents one model's 429 from locking the entire provider.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ErrorRule {
  /** Text pattern to match in error message (case-insensitive) */
  text?: string
  /** HTTP status code to match */
  status?: number
  /** Apply exponential backoff on this error */
  backoff?: boolean
  /** Fixed cooldown period in milliseconds */
  cooldownMs?: number
  /** Whether this is a retryable error (default: true if backoff is set) */
  retryable?: boolean
}

export interface ModelRateLimitState {
  rateLimitedUntil: number     // Timestamp when rate limit expires
  backoffLevel: number         // Current backoff level (0 = none)
  consecutiveErrors: number    // Number of consecutive errors
  lastErrorAt: number | null   // Timestamp of last error
  lastErrorType: string | null // Type of last error
}

export interface ProviderRateLimitState {
  models: Map<string, ModelRateLimitState>
  globalRateLimitedUntil: number
}

// ── Config ───────────────────────────────────────────────────────────────────

const BACKOFF_CONFIG = {
  baseMs: 2000,       // Start with 2s backoff
  maxMs: 300000,      // Cap at 5 minutes
  maxLevel: 15,       // Maximum backoff level
}

/**
 * Declarative error rules — checked top-to-bottom.
 * Text rules have higher priority than status-only rules.
 */
export const ERROR_RULES: ErrorRule[] = [
  // Text-based rules (highest priority)
  { text: 'rate limit', backoff: true, retryable: true },
  { text: 'too many requests', backoff: true, retryable: true },
  { text: 'temporarily overloaded', backoff: true, retryable: true },
  { text: 'quota exceeded', backoff: true, retryable: true },
  { text: 'capacity', backoff: true, retryable: true },
  { text: 'slow down', backoff: true, retryable: true },
  { text: 'try again', backoff: true, retryable: true },
  { text: 'no credentials', cooldownMs: 120000, retryable: false },
  { text: 'invalid api key', cooldownMs: 300000, retryable: false },
  { text: 'unauthorized', cooldownMs: 120000, retryable: false },
  { text: 'forbidden', cooldownMs: 60000, retryable: false },
  { text: 'insufficient_quota', cooldownMs: 300000, retryable: false },
  { text: 'billing', cooldownMs: 300000, retryable: false },
  { text: 'context window', cooldownMs: 10000, retryable: false },
  { text: 'maximum context length', cooldownMs: 10000, retryable: false },
  { text: 'token limit', cooldownMs: 10000, retryable: false },

  // Status-based rules (fallback)
  { status: 429, backoff: true, retryable: true },
  { status: 401, cooldownMs: 120000, retryable: false },
  { status: 403, cooldownMs: 60000, retryable: false },
  { status: 402, cooldownMs: 300000, retryable: false },
  { status: 503, backoff: true, retryable: true },
  { status: 502, cooldownMs: 5000, retryable: true },
  { status: 500, cooldownMs: 3000, retryable: true },
]

// ── Rate Limit State Manager ─────────────────────────────────────────────────

export class RateLimitManager {
  private providerStates: Map<string, ProviderRateLimitState> = new Map()

  /**
   * Get or create rate limit state for a provider
   */
  private getProviderState(provider: string): ProviderRateLimitState {
    if (!this.providerStates.has(provider)) {
      this.providerStates.set(provider, {
        models: new Map(),
        globalRateLimitedUntil: 0,
      })
    }
    return this.providerStates.get(provider)!
  }

  /**
   * Get rate limit state for a specific model within a provider
   */
  private getModelState(provider: string, model: string): ModelRateLimitState {
    const providerState = this.getProviderState(provider)
    if (!providerState.models.has(model)) {
      providerState.models.set(model, {
        rateLimitedUntil: 0,
        backoffLevel: 0,
        consecutiveErrors: 0,
        lastErrorAt: null,
        lastErrorType: null,
      })
    }
    return providerState.models.get(model)!
  }

  /**
   * Check if a specific model on a provider is currently rate-limited.
   *
   * v1.2: Read-only — does NOT create empty state for unseen provider/model
   * pairs. The previous implementation called getModelState() which mutated
   * the state map by inserting empty entries, which broke reset() tests and
   * caused unbounded memory growth in production.
   */
  isRateLimited(provider: string, model: string): boolean {
    const providerState = this.providerStates.get(provider)
    if (!providerState) return false
    const modelState = providerState.models.get(model)
    if (!modelState) return false
    const now = Date.now()
    return now < modelState.rateLimitedUntil || now < providerState.globalRateLimitedUntil
  }

  /**
   * Get the time until rate limit expires for a model (in ms).
   * Read-only — does not create state.
   */
  getRateLimitRemaining(provider: string, model: string): number {
    const providerState = this.providerStates.get(provider)
    if (!providerState) return 0
    const modelState = providerState.models.get(model)
    if (!modelState) return 0
    const now = Date.now()
    const modelRemaining = Math.max(0, modelState.rateLimitedUntil - now)
    const globalRemaining = Math.max(0, providerState.globalRateLimitedUntil - now)
    return Math.max(modelRemaining, globalRemaining)
  }

  /**
   * Record an error for a specific model and apply rate limiting
   */
  recordError(provider: string, model: string, error: Error & { status?: number }): {
    cooldownMs: number
    retryable: boolean
    rule: ErrorRule | null
  } {
    const matchedRule = this.matchErrorRule(error)
    const modelState = this.getModelState(provider, model)
    const now = Date.now()

    modelState.consecutiveErrors++
    modelState.lastErrorAt = now
    modelState.lastErrorType = matchedRule?.text || `status_${error.status}` || 'unknown'

    if (matchedRule?.backoff) {
      // Apply exponential backoff
      modelState.backoffLevel = Math.min(
        modelState.backoffLevel + 1,
        BACKOFF_CONFIG.maxLevel,
      )
      const backoffMs = Math.min(
        BACKOFF_CONFIG.baseMs * Math.pow(2, modelState.backoffLevel - 1),
        BACKOFF_CONFIG.maxMs,
      )
      modelState.rateLimitedUntil = now + backoffMs

      return {
        cooldownMs: backoffMs,
        retryable: matchedRule.retryable ?? true,
        rule: matchedRule,
      }
    }

    if (matchedRule?.cooldownMs) {
      modelState.rateLimitedUntil = now + matchedRule.cooldownMs

      return {
        cooldownMs: matchedRule.cooldownMs,
        retryable: matchedRule.retryable ?? false,
        rule: matchedRule,
      }
    }

    // No specific rule matched — default: short cooldown, retryable
    const defaultCooldown = 3000
    modelState.rateLimitedUntil = now + defaultCooldown

    return {
      cooldownMs: defaultCooldown,
      retryable: true,
      rule: null,
    }
  }

  /**
   * Record a successful response — reset backoff for this model
   */
  recordSuccess(provider: string, model: string): void {
    const modelState = this.getModelState(provider, model)
    modelState.backoffLevel = 0
    modelState.consecutiveErrors = 0
    modelState.rateLimitedUntil = 0
    modelState.lastErrorAt = null
    modelState.lastErrorType = null
  }

  /**
   * Find which models on a provider are currently available
   */
  getAvailableModels(provider: string, allModels: string[]): string[] {
    return allModels.filter(model => !this.isRateLimited(provider, model))
  }

  /**
   * Get the best available model from a provider's model list.
   * "Best" means the first model that isn't rate-limited.
   */
  getBestAvailableModel(provider: string, preferredModels: string[]): string | null {
    for (const model of preferredModels) {
      if (!this.isRateLimited(provider, model)) {
        return model
      }
    }
    return null
  }

  /**
   * Match an error against the declarative error rules.
   * Text rules are checked first (higher priority), then status rules.
   */
  private matchErrorRule(error: Error & { status?: number }): ErrorRule | null {
    const errorMessage = (error.message || '').toLowerCase()
    const errorStatus = error.status

    // Priority 1: Text-based rules
    for (const rule of ERROR_RULES) {
      if (rule.text && errorMessage.includes(rule.text.toLowerCase())) {
        return rule
      }
    }

    // Priority 2: Status-based rules
    if (errorStatus) {
      for (const rule of ERROR_RULES) {
        if (rule.status === errorStatus) {
          return rule
        }
      }
    }

    return null
  }

  /**
   * Get a summary of current rate limit state (for debugging/logging)
   */
  getStateSummary(): Record<string, Record<string, { rateLimited: boolean; remainingMs: number; backoffLevel: number }>> {
    const summary: Record<string, Record<string, { rateLimited: boolean; remainingMs: number; backoffLevel: number }>> = {}
    const now = Date.now()

    for (const [provider, providerState] of this.providerStates) {
      summary[provider] = {}
      for (const [model, modelState] of providerState.models) {
        summary[provider][model] = {
          rateLimited: now < modelState.rateLimitedUntil,
          remainingMs: Math.max(0, modelState.rateLimitedUntil - now),
          backoffLevel: modelState.backoffLevel,
        }
      }
    }

    return summary
  }

  /**
   * Clear all rate limit state (useful for testing)
   */
  reset(): void {
    this.providerStates.clear()
  }
}

// Singleton instance
export const rateLimitManager = new RateLimitManager()