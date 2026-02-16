/**
 * Agent Fallback System - Main Module
 * 
 * Implements the complete agent retry and fallback system with:
 * - Multi-layer fallback architecture
 * - Retry strategies
 * - Circuit breaker pattern
 * - Quality gates
 * - Error classification
 */

import { EventEmitter } from 'events';
import {
  AgentConfig,
  FallbackChain,
  RetryConfig,
  AgentRequest,
  AgentResponse,
  ExecuteOptions,
  SystemStatus,
  AgentStatus,
  ErrorCode,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_TIMEOUT_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_QUALITY_GATES_CONFIG,
  RetryAttemptEvent,
  RetrySuccessEvent,
  RetryFailureEvent,
  FallbackTriggeredEvent,
} from './types';
import { ErrorClassifier } from './error-classifier';
import { CircuitBreaker, CircuitBreakerManager } from './circuit-breaker';
import { 
  RetryStrategy, 
  ExponentialBackoffStrategy,
  createRetryStrategy,
  sleep,
  sleepWithAbort,
} from './retry-strategy';
import { QualityGates, MultiAgentQualityGates } from './quality-gates';

/**
 * Main agent fallback system
 */
export class AgentFallbackSystem extends EventEmitter {
  private agents: FallbackChain;
  private config: RetryConfig;
  private errorClassifier: ErrorClassifier;
  private circuitBreakerManager: CircuitBreakerManager;
  private retryStrategy: RetryStrategy;
  private qualityGates: MultiAgentQualityGates;
  
  // Statistics
  private totalRequests: number = 0;
  private successfulRequests: number = 0;
  private failedRequests: number = 0;
  private totalLatency: number = 0;
  private startTime: number = Date.now();
  
  // Agent adapters for execution
  private agentAdapters: Map<string, (request: AgentRequest) => Promise<AgentResponse>> = new Map();

  constructor(
    agents: FallbackChain, 
    config: Partial<RetryConfig> = {}
  ) {
    super();
    
    // Sort agents by priority
    this.agents = [...agents].sort((a, b) => a.priority - b.priority);
    
    // Merge config with defaults
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    
    // Initialize components
    this.errorClassifier = new ErrorClassifier(this.config);
    this.circuitBreakerManager = new CircuitBreakerManager(
      this.config.circuitBreaker || DEFAULT_CIRCUIT_BREAKER_CONFIG
    );
    this.retryStrategy = createRetryStrategy(this.config);
    this.qualityGates = new MultiAgentQualityGates(
      this.config.qualityGates || DEFAULT_QUALITY_GATES_CONFIG
    );
    
    // Set up circuit breaker event forwarding
    this.setupCircuitBreakerEvents();
  }

  /**
   * Register an agent adapter for execution
   */
  registerAdapter(
    agentName: string, 
    adapter: (request: AgentRequest) => Promise<AgentResponse>
  ): void {
    this.agentAdapters.set(agentName, adapter);
  }

  /**
   * Execute a prompt with automatic retry and fallback
   */
  async execute(
    prompt: string, 
    options: ExecuteOptions = {}
  ): Promise<AgentResponse> {
    this.totalRequests++;
    const startTime = Date.now();
    
    const request: AgentRequest = {
      prompt,
      ...options.context,
    };

    // Try each agent in the fallback chain
    for (let agentIndex = 0; agentIndex < this.agents.length; agentIndex++) {
      const agent = this.agents[agentIndex];
      const circuitBreaker = this.circuitBreakerManager.getBreaker(
        agent.name, 
        this.config.circuitBreaker
      );
      
      // Check if circuit allows execution
      if (!circuitBreaker.canExecute()) {
        this.emit('circuit:blocked', { agentName: agent.name });
        continue;
      }

      // Try executing with retries
      const response = await this.executeWithRetry(
        agent, 
        request, 
        options,
        circuitBreaker
      );

      // Check quality gates (unless skipped)
      if (!options.skipQualityGates && response.success) {
        const gates = this.qualityGates.getGates(agent.name);
        const qualityResult = gates.evaluate(response);
        
        if (!qualityResult.passed) {
          // Quality gates failed - emit event
          this.emit('quality:gate-failed', {
            agentName: agent.name,
            gates: qualityResult.failedGates,
            details: qualityResult.details,
          });
          
          // Determine if we should fallback
          if (this.shouldFallbackOnQuality(response)) {
            circuitBreaker.recordFailure();
            
            if (agentIndex < this.agents.length - 1) {
              // Trigger fallback to next agent
              this.emitFallback(agent.name, this.agents[agentIndex + 1].name, ErrorCode.QUALITY_THRESHOLD_NOT_MET);
              continue;
            }
          }
        }
      }

      // If successful, record success and return
      if (response.success) {
        circuitBreaker.recordSuccess();
        this.successfulRequests++;
        this.totalLatency += response.metadata.latency;
        
        this.emit('retry:success', {
          agentName: agent.name,
          totalAttempts: response.metadata.retries + 1,
          totalLatency: response.metadata.latency,
        } as RetrySuccessEvent);
        
        return response;
      }

      // If failed, check if we should fallback
      const classified = this.errorClassifier.classify(
        response.errorCode || ErrorCode.UNKNOWN_ERROR,
        response.error
      );

      if (classified.shouldFallback && agentIndex < this.agents.length - 1) {
        circuitBreaker.recordFailure();
        this.emitFallback(agent.name, this.agents[agentIndex + 1].name, response.errorCode || ErrorCode.UNKNOWN_ERROR);
        continue;
      }

      // Record failure
      circuitBreaker.recordFailure();
    }

    // All agents failed
    this.failedRequests++;
    const totalLatency = Date.now() - startTime;
    
    return {
      success: false,
      content: '',
      error: 'All agents in fallback chain have failed',
      errorCode: ErrorCode.SERVICE_UNAVAILABLE,
      agentName: 'none',
      metadata: {
        latency: totalLatency,
        timestamp: Date.now(),
        retries: 0,
      },
    };
  }

  /**
   * Execute a request to a specific agent with retry logic
   */
  private async executeWithRetry(
    agent: AgentConfig,
    request: AgentRequest,
    options: ExecuteOptions,
    circuitBreaker: CircuitBreaker
  ): Promise<AgentResponse> {
    const adapter = this.agentAdapters.get(agent.name);
    
    if (!adapter) {
      return {
        success: false,
        content: '',
        error: `No adapter registered for agent: ${agent.name}`,
        errorCode: ErrorCode.INTERNAL_ERROR,
        agentName: agent.name,
        metadata: {
          latency: 0,
          timestamp: Date.now(),
          retries: 0,
        },
      };
    }

    let attempt = 0;
    let lastError: Error = new Error('Unknown error');
    const timeout = options.timeout || this.config.timeout?.agent || DEFAULT_TIMEOUT_CONFIG.agent;

    while (this.retryStrategy.shouldRetry(attempt)) {
      // Check abort signal
      if (options.abortSignal?.aborted) {
        throw new Error('Aborted');
      }

      // Notify attempt
      if (options.onAttempt) {
        options.onAttempt(attempt, agent.name);
      }

      try {
        // Execute with timeout
        const response = await this.executeWithTimeout(
          adapter, 
          request, 
          timeout,
          options.abortSignal
        );

        // Update response metadata
        response.metadata.retries = attempt;
        response.agentName = agent.name;

        // Check if we should retry based on error classification
        if (!response.success && response.errorCode) {
          const classified = this.errorClassifier.classify(response.errorCode, response.error);
          
          if (!classified.retryable) {
            // Non-retryable error, return immediately
            return response;
          }
          
          // Check if we should fallback instead of retry
          if (classified.shouldFallback) {
            return response;
          }
        }

        // If successful or retryable error, check if we should continue
        if (response.success || (response.errorCode && !this.errorClassifier.isRetryable(response.errorCode))) {
          return response;
        }

        // Retryable error - continue to retry
        lastError = new Error(response.error);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Classify the error
        const classified = this.errorClassifier.classify(lastError);
        
        // Emit error classified event
        this.emit('error:classified', {
          error: classified.code,
          classification: classified.classification,
          retryable: classified.retryable,
          shouldFallback: classified.shouldFallback,
        });

        // Check if we should fallback
        if (classified.shouldFallback) {
          return {
            success: false,
            content: '',
            error: lastError.message,
            errorCode: classified.code,
            agentName: agent.name,
            metadata: {
              latency: 0,
              timestamp: Date.now(),
              retries: attempt,
            },
          };
        }

        // Check if we should continue retrying
        if (!classified.retryable) {
          return {
            success: false,
            content: '',
            error: lastError.message,
            errorCode: classified.code,
            agentName: agent.name,
            metadata: {
              latency: 0,
              timestamp: Date.now(),
              retries: attempt,
            },
          };
        }
      }

      // Emit retry attempt event
      this.emit('retry:attempt', {
        agentName: agent.name,
        attemptNumber: attempt + 1,
        maxRetries: this.config.maxRetries,
        delay: 0,
        error: lastError instanceof Error ? undefined : undefined,
      } as RetryAttemptEvent);

      // Calculate delay for next retry
      const delay = this.retryStrategy.getDelay(attempt);
      
      if (delay > 0) {
        await sleepWithAbort(delay, options.abortSignal);
      }

      attempt++;
    }

    // All retries exhausted
    this.emit('retry:failure', {
      agentName: agent.name,
      totalAttempts: attempt,
      finalError: this.errorClassifier.classify(lastError).code,
    } as RetryFailureEvent);

    return {
      success: false,
      content: '',
      error: `Max retries (${this.config.maxRetries}) exceeded: ${lastError.message}`,
      errorCode: this.errorClassifier.classify(lastError).code,
      agentName: agent.name,
      metadata: {
        latency: 0,
        timestamp: Date.now(),
        retries: attempt,
      },
    };
  }

  /**
   * Execute with timeout support
   */
  private async executeWithTimeout(
    adapter: (request: AgentRequest) => Promise<AgentResponse>,
    request: AgentRequest,
    timeout: number,
    abortSignal?: AbortSignal
  ): Promise<AgentResponse> {
    return Promise.race([
      adapter(request),
      new Promise<AgentResponse>((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout after ${timeout}ms`));
        }, timeout);
        
        if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            reject(new Error('Aborted'));
          });
        }
      }),
    ]);
  }

  /**
   * Determine if quality gate failure should trigger fallback
   */
  private shouldFallbackOnQuality(response: AgentResponse): boolean {
    const gatesConfig = this.config.qualityGates;
    if (!gatesConfig) return false;

    // Check latency
    if (response.metadata.latency > gatesConfig.latencyThreshold) {
      return true;
    }

    // Check response length
    if (response.content.length < (gatesConfig.minResponseLength || 1)) {
      return true;
    }

    return false;
  }

  /**
   * Emit fallback event
   */
  private emitFallback(fromAgent: string, toAgent: string, reason: ErrorCode): void {
    this.emit('fallback:triggered', {
      fromAgent,
      toAgent,
      reason,
      attemptNumber: 0,
    } as FallbackTriggeredEvent);
  }

  /**
   * Set up circuit breaker event forwarding
   */
  private setupCircuitBreakerEvents(): void {
    // Get breakers and forward events for each
    const originalGetBreaker = this.circuitBreakerManager.getBreaker.bind(this.circuitBreakerManager);
    
    // Override getBreaker to add event forwarding
    this.circuitBreakerManager.getBreaker = (name: string, config) => {
      const breaker = originalGetBreaker(name, config);
      
      // Forward events - only add listeners once
      if (!breaker.listenerCount('opened')) {
        breaker.on('opened', (event) => this.emit('circuit:opened', event));
        breaker.on('closed', (event) => this.emit('circuit:closed', event));
        breaker.on('half-open', (event) => this.emit('circuit:half-open', event));
      }
      
      return breaker;
    };
  }

  /**
   * Get system status
   */
  getStatus(): SystemStatus {
    const agentStatuses: AgentStatus[] = this.agents.map(agent => {
      const breaker = this.circuitBreakerManager.getBreaker(agent.name);
      const status = breaker.getStatus();
      
      return {
        name: agent.name,
        healthy: status.canExecute,
        circuitState: status.state,
        failureCount: status.failureCount,
        successCount: status.successCount,
        lastUsed: Date.now(),
        averageLatency: 0,
      };
    });

    return {
      overallHealthy: this.circuitBreakerManager.hasAvailableAgent(),
      agents: agentStatuses,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      averageLatency: this.successfulRequests > 0 
        ? this.totalLatency / this.successfulRequests 
        : 0,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Reset circuit breaker for an agent or all agents
   */
  resetCircuitBreaker(agentName?: string): void {
    if (agentName) {
      const breaker = this.circuitBreakerManager.getBreaker(agentName);
      breaker.reset();
    } else {
      this.circuitBreakerManager.resetAll();
    }
  }

  /**
   * Add an agent to the fallback chain
   */
  addAgent(agent: AgentConfig): void {
    this.agents.push(agent);
    this.agents.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Remove an agent from the fallback chain
   */
  removeAgent(agentName: string): void {
    const index = this.agents.findIndex(a => a.name === agentName);
    if (index !== -1) {
      this.agents.splice(index, 1);
      this.circuitBreakerManager.removeBreaker(agentName);
      this.agentAdapters.delete(agentName);
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
    this.errorClassifier.setConfig(this.config);
    this.retryStrategy = createRetryStrategy(this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }

  /**
   * Get the fallback chain
   */
  getAgents(): FallbackChain {
    return [...this.agents];
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.totalLatency = 0;
    this.startTime = Date.now();
  }
}

/**
 * Create an agent fallback system with default configuration
 */
export function createAgentFallbackSystem(
  agents: FallbackChain,
  config?: Partial<RetryConfig>
): AgentFallbackSystem {
  return new AgentFallbackSystem(agents, config);
}
