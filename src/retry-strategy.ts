/**
 * Retry Strategy Module
 * 
 * Implements various retry strategies including:
 * - Exponential Backoff
 * - Jitter
 * - Adaptive Retry
 */

import {
  RetryConfig,
  AdaptiveRetryConfig,
  DEFAULT_RETRY_CONFIG,
} from './types';

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateExponentialBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
  jitter: boolean = true
): number {
  // Calculate exponential delay: baseDelay * (multiplier ^ attempt)
  const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt);
  
  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  
  if (!jitter) {
    return Math.floor(cappedDelay);
  }
  
  // Add jitter: between 50% and 100% of the delay
  const jitterFactor = 0.5 + Math.random() * 0.5;
  return Math.floor(cappedDelay * jitterFactor);
}

/**
 * Calculate delay using exponential backoff with full jitter
 * (recommended approach to prevent thundering herd)
 */
export function calculateFullJitterBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  backoffMultiplier: number
): number {
  // Calculate exponential delay
  const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt);
  
  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  
  // Full jitter: random value between 0 and cappedDelay
  return Math.floor(Math.random() * cappedDelay);
}

/**
 * Calculate delay using exponential backoff with decorrelated jitter
 * (better for high contention scenarios)
 */
export function calculateDecorrelatedJitterBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  previousDelay?: number
): number {
  // Use previous delay if provided, otherwise use base delay
  const referenceDelay = previousDelay || baseDelay;
  
  // Decorrelated jitter: random value between baseDelay and 3 * previousDelay
  const delay = baseDelay + Math.random() * referenceDelay * 3;
  
  return Math.floor(Math.min(delay, maxDelay));
}

/**
 * Retry strategy interface
 */
export interface RetryStrategy {
  /**
   * Calculate the delay for the next retry attempt
   * @param attempt The current attempt number (0-indexed)
   * @param previousDelay The delay used in the previous attempt
   * @returns The delay in milliseconds
   */
  getDelay(attempt: number, previousDelay?: number): number;
  
  /**
   * Check if we should continue retrying
   * @param attempt The current attempt number
   * @returns True if we should continue
   */
  shouldRetry(attempt: number): boolean;
  
  /**
   * Reset the strategy state
   */
  reset(): void;
}

/**
 * Exponential backoff retry strategy
 */
export class ExponentialBackoffStrategy implements RetryStrategy {
  private config: RetryConfig;
  
  constructor(config: RetryConfig) {
    this.config = config;
  }
  
  getDelay(attempt: number, previousDelay?: number): number {
    return calculateExponentialBackoff(
      attempt,
      this.config.baseDelay,
      this.config.maxDelay,
      this.config.backoffMultiplier,
      this.config.jitter
    );
  }
  
  shouldRetry(attempt: number): boolean {
    return attempt < this.config.maxRetries;
  }
  
  reset(): void {
    // Nothing to reset for basic exponential backoff
  }
  
  /**
   * Update configuration
   */
  setConfig(config: RetryConfig): void {
    this.config = config;
  }
}

/**
 * Adaptive retry strategy that adjusts parameters based on observed behavior
 */
export class AdaptiveRetryStrategy implements RetryStrategy {
  private config: AdaptiveRetryConfig;
  private delayMultiplier: number = 1.0;
  private recentResults: boolean[] = [];
  private maxResultsWindow: number = 10;
  
  constructor(config: AdaptiveRetryConfig) {
    this.config = config;
  }
  
  /**
   * Record a result to influence future retry behavior
   */
  recordResult(success: boolean): void {
    this.recentResults.push(success);
    
    // Keep only the most recent results
    if (this.recentResults.length > this.maxResultsWindow) {
      this.recentResults.shift();
    }
    
    // Adjust delay multiplier based on results
    this.adjustParameters();
  }
  
  /**
   * Adjust retry parameters based on observed patterns
   */
  private adjustParameters(): void {
    if (this.recentResults.length < 3) {
      return; // Not enough data
    }
    
    const successRate = this.recentResults.filter(r => r).length / this.recentResults.length;
    
    if (successRate >= this.config.successWeight) {
      // Good success rate - reduce delays
      const adjustment = 1 - this.config.adjustmentFactor;
      this.delayMultiplier = Math.max(
        this.delayMultiplier * adjustment,
        this.config.minDelayMultiplier || 0.5
      );
    } else if (successRate <= this.config.failureWeight) {
      // Poor success rate - increase delays
      const adjustment = 1 + this.config.adjustmentFactor;
      this.delayMultiplier = Math.min(
        this.delayMultiplier * adjustment,
        this.config.maxDelayMultiplier || 3.0
      );
    }
  }
  
  getDelay(attempt: number, previousDelay?: number): number {
    const baseDelay = calculateExponentialBackoff(
      attempt,
      1000, // Use standard base delay
      30000,
      2,
      this.config.enabled
    );
    
    return Math.floor(baseDelay * this.delayMultiplier);
  }
  
  shouldRetry(attempt: number): boolean {
    return attempt < 5; // Allow more retries with adaptive approach
  }
  
  reset(): void {
    this.delayMultiplier = 1.0;
    this.recentResults = [];
  }
  
  /**
   * Get current delay multiplier
   */
  getDelayMultiplier(): number {
    return this.delayMultiplier;
  }
  
  /**
   * Get recent success rate
   */
  getSuccessRate(): number {
    if (this.recentResults.length === 0) {
      return 0;
    }
    return this.recentResults.filter(r => r).length / this.recentResults.length;
  }
}

/**
 * Retry strategy that combines exponential backoff with circuit breaker awareness
 */
export class CircuitBreakerAwareStrategy implements RetryStrategy {
  private exponentialBackoff: ExponentialBackoffStrategy;
  private config: RetryConfig;
  private consecutiveFailures: number = 0;
  private lastSuccessTime: number = 0;
  
  constructor(config: RetryConfig) {
    this.config = config;
    this.exponentialBackoff = new ExponentialBackoffStrategy(config);
  }
  
  getDelay(attempt: number, previousDelay?: number): number {
    let delay = this.exponentialBackoff.getDelay(attempt, previousDelay);
    
    // Add extra delay based on consecutive failures
    if (this.consecutiveFailures > 0) {
      const extraDelay = Math.min(5000, this.consecutiveFailures * 1000);
      delay = Math.min(delay + extraDelay, this.config.maxDelay);
    }
    
    return delay;
  }
  
  shouldRetry(attempt: number): boolean {
    // Use configured max retries
    return attempt < this.config.maxRetries;
  }
  
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();
  }
  
  recordFailure(): void {
    this.consecutiveFailures++;
  }
  
  reset(): void {
    this.consecutiveFailures = 0;
    this.exponentialBackoff.reset();
  }
  
  /**
   * Get the number of consecutive failures
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }
  
  /**
   * Check if we're in a "hot" failure state (recent failures)
   */
  isHot(): boolean {
    const timeSinceLastSuccess = Date.now() - this.lastSuccessTime;
    return this.consecutiveFailures >= 3 || timeSinceLastSuccess < 60000;
  }
}

/**
 * Factory function to create appropriate retry strategy
 */
export function createRetryStrategy(
  config: RetryConfig,
  type: 'exponential' | 'adaptive' | 'circuit-aware' = 'exponential'
): RetryStrategy {
  switch (type) {
    case 'adaptive':
      if (config.adaptiveRetry?.enabled) {
        return new AdaptiveRetryStrategy(config.adaptiveRetry);
      }
      return new ExponentialBackoffStrategy(config);
    
    case 'circuit-aware':
      return new CircuitBreakerAwareStrategy(config);
    
    case 'exponential':
    default:
      return new ExponentialBackoffStrategy(config);
  }
}

/**
 * Sleep utility for delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sleep with abort support
 */
export function sleepWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Aborted'));
      });
    }
  });
}
