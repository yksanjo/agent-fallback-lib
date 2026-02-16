/**
 * Error Classifier Module
 * 
 * Provides error classification and determination of retryability
 * for the agent fallback system.
 */

import {
  ErrorCode,
  ErrorClassification,
  ClassifiedError,
  RetryConfig,
} from './types';

/**
 * Error classifier that determines error characteristics
 */
export class ErrorClassifier {
  private config: RetryConfig;

  // Mapping of error codes to their classifications
  private static readonly ERROR_CLASSIFICATIONS: Record<ErrorCode, {
    classification: ErrorClassification;
    retryable: boolean;
    shouldFallback: boolean;
  }> = {
    // Network errors
    [ErrorCode.TIMEOUT]: {
      classification: 'timeout',
      retryable: true,
      shouldFallback: true,
    },
    [ErrorCode.CONNECTION_ERROR]: {
      classification: 'network',
      retryable: true,
      shouldFallback: true,
    },
    [ErrorCode.DNS_ERROR]: {
      classification: 'network',
      retryable: true,
      shouldFallback: true,
    },
    
    // Authentication errors
    [ErrorCode.AUTHENTICATION_ERROR]: {
      classification: 'authentication',
      retryable: false,
      shouldFallback: false,
    },
    [ErrorCode.INVALID_API_KEY]: {
      classification: 'authentication',
      retryable: false,
      shouldFallback: true,
    },
    [ErrorCode.PERMISSION_DENIED]: {
      classification: 'authentication',
      retryable: false,
      shouldFallback: false,
    },
    
    // Rate limiting
    [ErrorCode.RATE_LIMIT]: {
      classification: 'rate_limit',
      retryable: true,
      shouldFallback: true,
    },
    [ErrorCode.QUOTA_EXCEEDED]: {
      classification: 'rate_limit',
      retryable: false,
      shouldFallback: true,
    },
    
    // Model errors
    [ErrorCode.MODEL_NOT_FOUND]: {
      classification: 'model',
      retryable: false,
      shouldFallback: true,
    },
    [ErrorCode.MODEL_OVERLOADED]: {
      classification: 'model',
      retryable: true,
      shouldFallback: true,
    },
    [ErrorCode.CONTEXT_LENGTH_EXCEEDED]: {
      classification: 'model',
      retryable: false,
      shouldFallback: true,
    },
    
    // Response errors
    [ErrorCode.INVALID_RESPONSE]: {
      classification: 'quality',
      retryable: true,
      shouldFallback: true,
    },
    [ErrorCode.PARSE_ERROR]: {
      classification: 'quality',
      retryable: true,
      shouldFallback: true,
    },
    [ErrorCode.EMPTY_RESPONSE]: {
      classification: 'quality',
      retryable: true,
      shouldFallback: true,
    },
    
    // Quality errors
    [ErrorCode.QUALITY_THRESHOLD_NOT_MET]: {
      classification: 'quality',
      retryable: false,
      shouldFallback: true,
    },
    [ErrorCode.LATENCY_TOO_HIGH]: {
      classification: 'quality',
      retryable: false,
      shouldFallback: true,
    },
    
    // System errors
    [ErrorCode.INTERNAL_ERROR]: {
      classification: 'system',
      retryable: true,
      shouldFallback: false,
    },
    [ErrorCode.SERVICE_UNAVAILABLE]: {
      classification: 'system',
      retryable: true,
      shouldFallback: true,
    },
    [ErrorCode.UNKNOWN_ERROR]: {
      classification: 'unknown',
      retryable: false,
      shouldFallback: false,
    },
    
    // Custom errors
    [ErrorCode.CUSTOM_ERROR]: {
      classification: 'unknown',
      retryable: false,
      shouldFallback: false,
    },
  };

  constructor(config: RetryConfig) {
    this.config = config;
  }

  /**
   * Classify an error based on error code or message
   */
  classify(error: Error | ErrorCode | string, customMessage?: string): ClassifiedError {
    // Handle different input types
    let errorCode: ErrorCode;
    let errorMessage: string;

    if (error instanceof Error) {
      errorCode = this.extractErrorCode(error);
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorCode = this.determineErrorCodeFromMessage(error);
      errorMessage = error;
    } else {
      errorCode = error;
      errorMessage = customMessage || error;
    }

    // Get base classification
    const classification = ErrorClassifier.ERROR_CLASSIFICATIONS[errorCode] || {
      classification: 'unknown' as ErrorClassification,
      retryable: false,
      shouldFallback: false,
    };

    // Check custom fallback errors from config
    const shouldFallback = classification.shouldFallback || 
      (this.config.fallbackOnErrors?.includes(errorCode) ?? false);

    // Check custom retryable errors from config
    const retryable = classification.retryable || 
      (this.config.retryableErrors?.includes(errorCode) ?? false);

    return {
      code: errorCode,
      classification: classification.classification,
      retryable,
      shouldFallback,
      message: errorMessage,
    };
  }

  /**
   * Check if an error is retryable
   */
  isRetryable(error: Error | ErrorCode | string): boolean {
    const classified = this.classify(error);
    return classified.retryable;
  }

  /**
   * Check if an error should trigger fallback
   */
  shouldFallback(error: Error | ErrorCode | string): boolean {
    const classified = this.classify(error);
    return classified.shouldFallback;
  }

  /**
   * Extract error code from an Error object
   */
  private extractErrorCode(error: Error): ErrorCode {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Check for timeout
    if (message.includes('timeout') || name.includes('timeout')) {
      return ErrorCode.TIMEOUT;
    }

    // Check for rate limit
    if (message.includes('rate limit') || message.includes('rate_limit') || 
        message.includes('too many requests')) {
      return ErrorCode.RATE_LIMIT;
    }

    // Check for authentication
    if (message.includes('authentication') || message.includes('unauthorized') ||
        message.includes('invalid api key') || message.includes('api key')) {
      return ErrorCode.INVALID_API_KEY;
    }

    // Check for quota
    if (message.includes('quota') || message.includes('exceeded') ||
        message.includes('insufficient credits')) {
      return ErrorCode.QUOTA_EXCEEDED;
    }

    // Check for model overloaded
    if (message.includes('overloaded') || message.includes('model overloaded')) {
      return ErrorCode.MODEL_OVERLOADED;
    }

    // Check for context length
    if (message.includes('context length') || message.includes('max tokens') ||
        message.includes('token limit')) {
      return ErrorCode.CONTEXT_LENGTH_EXCEEDED;
    }

    // Check for connection errors
    if (message.includes('connection') || message.includes('network') ||
        message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      return ErrorCode.CONNECTION_ERROR;
    }

    // Check for service unavailable
    if (message.includes('503') || message.includes('service unavailable') ||
        message.includes('unavailable')) {
      return ErrorCode.SERVICE_UNAVAILABLE;
    }

    // Check for empty response
    if (message.includes('empty') || message.includes('no response')) {
      return ErrorCode.EMPTY_RESPONSE;
    }

    // Check for invalid response
    if (message.includes('invalid response') || message.includes('parse')) {
      return ErrorCode.INVALID_RESPONSE;
    }

    // Check for permission denied
    if (message.includes('permission') || message.includes('forbidden') ||
        message.includes('403')) {
      return ErrorCode.PERMISSION_DENIED;
    }

    // Check for model not found
    if (message.includes('model not found') || message.includes('404')) {
      return ErrorCode.MODEL_NOT_FOUND;
    }

    // Default to unknown error
    return ErrorCode.UNKNOWN_ERROR;
  }

  /**
   * Determine error code from error message string
   */
  private determineErrorCodeFromMessage(message: string): ErrorCode {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('timeout')) return ErrorCode.TIMEOUT;
    if (lowerMessage.includes('rate limit')) return ErrorCode.RATE_LIMIT;
    if (lowerMessage.includes('authentication') || lowerMessage.includes('api key')) {
      return ErrorCode.INVALID_API_KEY;
    }
    if (lowerMessage.includes('quota')) return ErrorCode.QUOTA_EXCEEDED;
    if (lowerMessage.includes('overloaded')) return ErrorCode.MODEL_OVERLOADED;
    if (lowerMessage.includes('context length')) return ErrorCode.CONTEXT_LENGTH_EXCEEDED;
    if (lowerMessage.includes('connection')) return ErrorCode.CONNECTION_ERROR;
    if (lowerMessage.includes('unavailable')) return ErrorCode.SERVICE_UNAVAILABLE;
    if (lowerMessage.includes('empty')) return ErrorCode.EMPTY_RESPONSE;
    if (lowerMessage.includes('invalid response')) return ErrorCode.INVALID_RESPONSE;
    if (lowerMessage.includes('permission')) return ErrorCode.PERMISSION_DENIED;
    if (lowerMessage.includes('model not found')) return ErrorCode.MODEL_NOT_FOUND;

    return ErrorCode.CUSTOM_ERROR;
  }

  /**
   * Update the configuration
   */
  setConfig(config: RetryConfig): void {
    this.config = config;
  }
}

/**
 * Create a default error classifier with default config
 */
export function createErrorClassifier(config: RetryConfig): ErrorClassifier {
  return new ErrorClassifier(config);
}
