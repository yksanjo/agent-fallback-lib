/**
 * Circuit Breaker Module
 * 
 * Implements the circuit breaker pattern to prevent cascading failures
 * and allow for automatic recovery.
 */

import { EventEmitter } from 'events';
import {
  CircuitBreakerConfig,
  CircuitState,
  CircuitOpenedEvent,
  CircuitClosedEvent,
  CircuitHalfOpenEvent,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from './types';

/**
 * Circuit breaker for individual agents
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenAttempts: number = 0;
  private config: CircuitBreakerConfig;
  private readonly agentName: string;

  constructor(agentName: string, config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    super();
    this.agentName = agentName;
    this.config = config;
  }

  /**
   * Get the current state of the circuit breaker
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if the circuit is closed (normal operation)
   */
  isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * Check if the circuit is open (failing)
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Check if the circuit is half-open (testing recovery)
   */
  isHalfOpen(): boolean {
    return this.state === CircuitState.HALF_OPEN;
  }

  /**
   * Attempt to execute an action through the circuit breaker
   * Returns true if the action can proceed
   */
  canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      
      case CircuitState.OPEN:
        // Check if recovery timeout has passed
        if (this.shouldAttemptRecovery()) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;
      
      case CircuitState.HALF_OPEN:
        // Allow limited attempts in half-open state
        return this.halfOpenAttempts < this.config.halfOpenAttempts;
      
      default:
        return false;
    }
  }

  /**
   * Record a successful execution
   */
  recordSuccess(): void {
    this.successCount++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Successful in half-open means recovery
      this.transitionToClosed();
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success in closed state
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  /**
   * Record a failed execution
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Failure in half-open means go back to open
      this.transitionToOpen();
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we should open the circuit
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureTime = 0;
    
    this.emit('reset', { agentName: this.agentName });
  }

  /**
   * Get the number of consecutive failures
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Get the number of consecutive successes
   */
  getSuccessCount(): number {
    return this.successCount;
  }

  /**
   * Get configuration
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if enough time has passed to attempt recovery
   */
  private shouldAttemptRecovery(): boolean {
    const now = Date.now();
    return now - this.lastFailureTime >= this.config.recoveryTimeout;
  }

  /**
   * Transition to open state
   */
  private transitionToOpen(): void {
    if (this.state !== CircuitState.OPEN) {
      this.state = CircuitState.OPEN;
      this.halfOpenAttempts = 0;
      
      const event: CircuitOpenedEvent = {
        agentName: this.agentName,
        failureCount: this.failureCount,
        threshold: this.config.failureThreshold,
      };
      
      this.emit('opened', event);
    }
  }

  /**
   * Transition to closed state (recovered)
   */
  private transitionToClosed(): void {
    if (this.state !== CircuitState.CLOSED) {
      this.state = CircuitState.CLOSED;
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
      
      const event: CircuitClosedEvent = {
        agentName: this.agentName,
        successCount: this.successCount,
      };
      
      this.emit('closed', event);
    }
  }

  /**
   * Transition to half-open state (testing recovery)
   */
  private transitionToHalfOpen(): void {
    if (this.state !== CircuitState.HALF_OPEN) {
      this.state = CircuitState.HALF_OPEN;
      this.halfOpenAttempts = 0;
      
      const event: CircuitHalfOpenEvent = {
        agentName: this.agentName,
        attemptNumber: 0,
      };
      
      this.emit('half-open', event);
    }
    
    this.halfOpenAttempts++;
  }

  /**
   * Get status information
   */
  getStatus(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    canExecute: boolean;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      canExecute: this.canExecute(),
    };
  }
}

/**
 * Circuit breaker manager for multiple agents
 */
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: CircuitBreakerConfig;

  constructor(defaultConfig: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create a circuit breaker for an agent
   */
  getBreaker(agentName: string, config?: CircuitBreakerConfig): CircuitBreaker {
    let breaker = this.breakers.get(agentName);
    
    if (!breaker) {
      breaker = new CircuitBreaker(agentName, config || this.defaultConfig);
      this.breakers.set(agentName, breaker);
    }
    
    return breaker;
  }

  /**
   * Remove a circuit breaker
   */
  removeBreaker(agentName: string): boolean {
    return this.breakers.delete(agentName);
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
  }

  /**
   * Get status of all circuit breakers
   */
  getAllStatus(): Map<string, ReturnType<CircuitBreaker['getStatus']>> {
    const status = new Map();
    this.breakers.forEach((breaker, name) => {
      status.set(name, breaker.getStatus());
    });
    return status;
  }

  /**
   * Update default configuration
   */
  setDefaultConfig(config: CircuitBreakerConfig): void {
    this.defaultConfig = config;
  }

  /**
   * Check if any circuit is closed (at least one agent available)
   */
  hasAvailableAgent(): boolean {
    for (const breaker of this.breakers.values()) {
      if (breaker.canExecute()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get list of available agents
   */
  getAvailableAgents(): string[] {
    const available: string[] = [];
    this.breakers.forEach((breaker, name) => {
      if (breaker.canExecute()) {
        available.push(name);
      }
    });
    return available;
  }
}
