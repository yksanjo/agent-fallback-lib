/**
 * Agent Retry & Fallback System - Type Definitions
 * 
 * This module provides type definitions for the agent fallback system,
 * including configurations, interfaces, and error types.
 */

// ============================================================================
// Core Type Definitions
// ============================================================================

/**
 * Configuration for an agent in the fallback chain
 */
export interface AgentConfig {
  /** Unique identifier for the agent */
  name: string;
  /** Provider name (e.g., 'openai', 'anthropic') */
  provider: string;
  /** Priority in the fallback chain (lower = higher priority) */
  priority: number;
  /** Optional custom endpoint URL */
  endpoint?: string;
  /** Optional API key (should be handled securely) */
  apiKey?: string;
  /** Model identifier */
  model?: string;
  /** Maximum requests per minute */
  rateLimit?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Fallback chain - ordered array of agents
 */
export interface FallbackChain extends Array<AgentConfig> {}

/**
 * Request sent to an agent
 */
export interface AgentRequest {
  /** The prompt/content to send to the agent */
  prompt: string;
  /** Optional system message */
  systemMessage?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature parameter */
  temperature?: number;
  /** Additional parameters */
  parameters?: Record<string, unknown>;
  /** Request metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Response from an agent
 */
export interface AgentResponse {
  /** Whether the request was successful */
  success: boolean;
  /** The generated content */
  content: string;
  /** Error message if unsuccessful */
  error?: string;
  /** Error code for classification */
  errorCode?: ErrorCode;
  /** Agent that generated the response */
  agentName: string;
  /** Timing information */
  metadata: ResponseMetadata;
}

/**
 * Metadata about the response
 */
export interface ResponseMetadata {
  /** Latency in milliseconds */
  latency: number;
  /** Token usage if available */
  tokensUsed?: number;
  /** Timestamp of the request */
  timestamp: number;
  /** Number of retries attempted */
  retries: number;
  /** Model used */
  model?: string;
  /** Additional metadata */
  [key: string]: unknown;
}

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Main retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Whether to add jitter to delays */
  jitter: boolean;
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerConfig;
  /** Adaptive retry configuration */
  adaptiveRetry?: AdaptiveRetryConfig;
  /** Quality gates configuration */
  qualityGates?: QualityGatesConfig;
  /** Timeout configuration */
  timeout?: TimeoutConfig;
  /** Error codes that should trigger fallback */
  fallbackOnErrors?: ErrorCode[];
  /** Custom retryable errors */
  retryableErrors?: string[];
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in milliseconds to wait before attempting recovery */
  recoveryTimeout: number;
  /** Number of attempts in half-open state */
  halfOpenAttempts: number;
}

/**
 * Adaptive retry configuration
 */
export interface AdaptiveRetryConfig {
  /** Whether adaptive retry is enabled */
  enabled: boolean;
  /** Weight for successful responses */
  successWeight: number;
  /** Weight for failures */
  failureWeight: number;
  /** Factor for adjusting retry parameters */
  adjustmentFactor: number;
  /** Minimum delay multiplier */
  minDelayMultiplier?: number;
  /** Maximum delay multiplier */
  maxDelayMultiplier?: number;
}

/**
 * Quality gates configuration
 */
export interface QualityGatesConfig {
  /** Minimum response length */
  minResponseLength: number;
  /** Maximum acceptable error rate */
  maxErrorRate: number;
  /** Maximum latency threshold in milliseconds */
  latencyThreshold: number;
  /** Minimum quality score (0-1) */
  minQualityScore?: number;
}

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  /** Timeout for individual agent in milliseconds */
  agent: number;
  /** Total timeout for entire operation in milliseconds */
  total: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for classification
 */
export enum ErrorCode {
  // Network errors
  TIMEOUT = 'TIMEOUT',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  DNS_ERROR = 'DNS_ERROR',
  
  // Authentication errors
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  INVALID_API_KEY = 'INVALID_API_KEY',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  
  // Rate limiting
  RATE_LIMIT = 'RATE_LIMIT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  
  // Model errors
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  MODEL_OVERLOADED = 'MODEL_OVERLOADED',
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  
  // Response errors
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  PARSE_ERROR = 'PARSE_ERROR',
  EMPTY_RESPONSE = 'EMPTY_RESPONSE',
  
  // Quality errors
  QUALITY_THRESHOLD_NOT_MET = 'QUALITY_THRESHOLD_NOT_MET',
  LATENCY_TOO_HIGH = 'LATENCY_TOO_HIGH',
  
  // System errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  
  // Custom errors
  CUSTOM_ERROR = 'CUSTOM_ERROR',
}

/**
 * Classification of an error
 */
export type ErrorClassification = 
  | 'timeout'
  | 'rate_limit'
  | 'authentication'
  | 'model'
  | 'quality'
  | 'network'
  | 'system'
  | 'unknown';

/**
 * Error classification result
 */
export interface ClassifiedError {
  code: ErrorCode;
  classification: ErrorClassification;
  retryable: boolean;
  shouldFallback: boolean;
  message: string;
}

// ============================================================================
// System Status Types
// ============================================================================

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

/**
 * Agent status
 */
export interface AgentStatus {
  name: string;
  healthy: boolean;
  circuitState: CircuitState;
  failureCount: number;
  successCount: number;
  lastUsed: number;
  lastError?: ErrorCode;
  averageLatency: number;
}

/**
 * System status
 */
export interface SystemStatus {
  overallHealthy: boolean;
  currentAgent?: string;
  agents: AgentStatus[];
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  uptime: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the system
 */
export interface SystemEvents {
  'retry:attempt': RetryAttemptEvent;
  'retry:success': RetrySuccessEvent;
  'retry:failure': RetryFailureEvent;
  'fallback:triggered': FallbackTriggeredEvent;
  'circuit:opened': CircuitOpenedEvent;
  'circuit:closed': CircuitClosedEvent;
  'circuit:half-open': CircuitHalfOpenEvent;
  'quality:gate-failed': QualityGateFailedEvent;
  'error:classified': ErrorClassifiedEvent;
}

/**
 * Retry attempt event
 */
export interface RetryAttemptEvent {
  agentName: string;
  attemptNumber: number;
  maxRetries: number;
  delay: number;
  error?: ErrorCode;
}

/**
 * Retry success event
 */
export interface RetrySuccessEvent {
  agentName: string;
  totalAttempts: number;
  totalLatency: number;
}

/**
 * Retry failure event
 */
export interface RetryFailureEvent {
  agentName: string;
  totalAttempts: number;
  finalError: ErrorCode;
}

/**
 * Fallback triggered event
 */
export interface FallbackTriggeredEvent {
  fromAgent: string;
  toAgent: string;
  reason: ErrorCode;
  attemptNumber: number;
}

/**
 * Circuit opened event
 */
export interface CircuitOpenedEvent {
  agentName: string;
  failureCount: number;
  threshold: number;
}

/**
 * Circuit closed event
 */
export interface CircuitClosedEvent {
  agentName: string;
  successCount: number;
}

/**
 * Circuit half-open event
 */
export interface CircuitHalfOpenEvent {
  agentName: string;
  attemptNumber: number;
}

/**
 * Quality gate failed event
 */
export interface QualityGateFailedEvent {
  agentName: string;
  gate: string;
  actual: number;
  expected: number;
}

/**
 * Error classified event
 */
export interface ErrorClassifiedEvent {
  error: ErrorCode;
  classification: ErrorClassification;
  retryable: boolean;
  shouldFallback: boolean;
}

// ============================================================================
// Execute Options
// ============================================================================

/**
 * Options for executing a request
 */
export interface ExecuteOptions {
  /** Override the default timeout */
  timeout?: number;
  /** Skip quality gates */
  skipQualityGates?: boolean;
  /** Custom context for the request */
  context?: Record<string, unknown>;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Callback for each attempt */
  onAttempt?: (attempt: number, agent: string) => void;
}

// ============================================================================
// Agent Adapter Interface
// ============================================================================

/**
 * Interface for custom agent adapters
 */
export interface AgentAdapter {
  /** Agent name */
  name: string;
  /** Execute a request */
  execute(request: AgentRequest): Promise<AgentResponse>;
  /** Check if agent is healthy */
  healthCheck(): Promise<boolean>;
  /** Get current load */
  getLoad?(): Promise<number>;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
  fallbackOnErrors: [
    ErrorCode.TIMEOUT,
    ErrorCode.RATE_LIMIT,
    ErrorCode.MODEL_OVERLOADED,
    ErrorCode.INVALID_RESPONSE,
    ErrorCode.SERVICE_UNAVAILABLE,
    ErrorCode.CONNECTION_ERROR,
  ],
};

/**
 * Default timeout configuration
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  agent: 30000,
  total: 120000,
};

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeout: 60000,
  halfOpenAttempts: 3,
};

/**
 * Default quality gates configuration
 */
export const DEFAULT_QUALITY_GATES_CONFIG: QualityGatesConfig = {
  minResponseLength: 1,
  maxErrorRate: 0.1,
  latencyThreshold: 30000,
};
