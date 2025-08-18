import { Logger } from './cli-utils';

export enum ErrorCode {
  // System errors
  SYSTEM_REQUIREMENTS_NOT_MET = 'SYSTEM_REQUIREMENTS_NOT_MET',
  INSUFFICIENT_MEMORY = 'INSUFFICIENT_MEMORY',
  FILE_PERMISSION_DENIED = 'FILE_PERMISSION_DENIED',

  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  TYPESCRIPT_CONFIG_ERROR = 'TYPESCRIPT_CONFIG_ERROR',

  // Database errors
  DATABASE_CONNECTION_FAILED = 'DATABASE_CONNECTION_FAILED',
  DATABASE_NOT_INITIALIZED = 'DATABASE_NOT_INITIALIZED',
  DATABASE_CORRUPTION = 'DATABASE_CORRUPTION',
  MIGRATION_FAILED = 'MIGRATION_FAILED',
  STORAGE_ERROR = 'STORAGE_ERROR',
  STORAGE_WRITE_ERROR = 'STORAGE_WRITE_ERROR',

  // Analysis errors
  PARSING_FAILED = 'PARSING_FAILED',
  FILE_NOT_ACCESSIBLE = 'FILE_NOT_ACCESSIBLE',
  ANALYSIS_TIMEOUT = 'ANALYSIS_TIMEOUT',
  ANALYSIS_FAILED = 'ANALYSIS_FAILED',
  
  // Resource errors
  NOT_FOUND = 'NOT_FOUND',

  // Generic errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  OPERATION_CANCELLED = 'OPERATION_CANCELLED',
}

export interface FuncqcError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  recoveryActions?: string[];
  originalError?: Error;
  stack?: string;
}

/**
 * Shape-based error interface for DatabaseError-like objects
 */
export interface DatabaseErrorLike {
  code: string;
  message: string;
  originalError?: Error;
}

/**
 * Type guard function to check if an error is DatabaseError-like
 */
export function isDatabaseErrorLike(error: unknown): error is DatabaseErrorLike {
  return !!(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as Record<string, unknown>).code === 'string' &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

export interface ErrorHandlerOptions {
  maxRetries: number;
  retryDelay: number;
  enableRecovery: boolean;
  logLevel: 'error' | 'warn' | 'debug';
}

export class ErrorHandler {
  private logger: Logger;
  private options: ErrorHandlerOptions;

  constructor(logger: Logger, options: Partial<ErrorHandlerOptions> = {}) {
    this.logger = logger;
    this.options = {
      maxRetries: 3,
      retryDelay: 1000,
      enableRecovery: true,
      logLevel: 'error',
      ...options,
    };
  }

  createError(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    originalError?: Error
  ): FuncqcError {
    const errorInfo = this.getErrorInfo(code);

    const result: FuncqcError = {
      code,
      message,
      recoverable: errorInfo.recoverable,
      stack: originalError?.stack || new Error().stack,
    } as FuncqcError;

    if (details) result.details = details;
    if (errorInfo.recoveryActions) result.recoveryActions = errorInfo.recoveryActions;
    if (originalError) result.originalError = originalError;

    return result;
  }

  private getErrorInfo(code: ErrorCode): { recoverable: boolean; recoveryActions?: string[] } {
    switch (code) {
      case ErrorCode.SYSTEM_REQUIREMENTS_NOT_MET:
        return {
          recoverable: false,
          recoveryActions: [
            'Update Node.js to version 18 or higher',
            'Install Git if Git integration is needed',
            'Ensure you are in a TypeScript project directory',
          ],
        };

      case ErrorCode.INSUFFICIENT_MEMORY:
        return {
          recoverable: true,
          recoveryActions: [
            'Close other applications to free memory',
            'Process smaller batches of files',
            'Use --exclude to reduce analysis scope',
          ],
        };

      case ErrorCode.FILE_PERMISSION_DENIED:
        return {
          recoverable: true,
          recoveryActions: [
            'Check file permissions',
            'Run with appropriate user privileges',
            'Ensure funcqc database directory is writable',
          ],
        };

      case ErrorCode.DATABASE_NOT_INITIALIZED:
        return {
          recoverable: true,
          recoveryActions: ['Run: funcqc init', 'Run: funcqc scan', 'Then try your command again'],
        };

      case ErrorCode.DATABASE_CORRUPTION:
        return {
          recoverable: true,
          recoveryActions: [
            'Backup current data if possible',
            'Run funcqc --repair-database',
            'Reinitialize with funcqc init --force if repair fails',
          ],
        };

      case ErrorCode.PARSING_FAILED:
        return {
          recoverable: true,
          recoveryActions: [
            'Check TypeScript syntax errors',
            'Ensure tsconfig.json is valid',
            'Use --exclude to skip problematic files',
          ],
        };

      case ErrorCode.ANALYSIS_TIMEOUT:
        return {
          recoverable: true,
          recoveryActions: [
            'Increase timeout with --timeout option',
            'Process smaller batches of files',
            'Exclude large or complex files',
          ],
        };
      
      case ErrorCode.ANALYSIS_FAILED:
        return {
          recoverable: true,
          recoveryActions: [
            'Re-run with --verbose or --debug to collect detailed logs',
            'Narrow the analysis scope using include/exclude filters',
            'Fix any upstream TypeScript errors and retry',
            'Try analyzing a smaller snapshot or subset of files',
          ],
        };
      
      case ErrorCode.NOT_FOUND:
        return {
          recoverable: true,
          recoveryActions: [
            'Check that the resource exists',
            'Verify the name is correct',
            'Run funcqc scan if data is missing',
          ],
        };

      default:
        return { recoverable: false };
    }
  }

  handleError(error: FuncqcError | Error): never {
    const funcqcError =
      error instanceof Error
        ? this.createError(ErrorCode.UNKNOWN_ERROR, error.message, {}, error)
        : error;

    this.logError(funcqcError);

    if (funcqcError.recoverable && this.options.enableRecovery) {
      this.suggestRecovery(funcqcError);
    }

    // Set appropriate exit code
    const exitCode = this.getExitCode(funcqcError.code);
    process.exit(exitCode);
  }

  private logError(error: FuncqcError): void {
    this.logger.error(`[${error.code}] ${error.message}`);

    if (error.details) {
      this.logger.error('Details:', error.details);
    }

    if (error.originalError && this.logger instanceof Logger) {
      this.logger.error('Original error:', error.originalError);
    }
  }

  private suggestRecovery(error: FuncqcError): void {
    if (error.recoveryActions && error.recoveryActions.length > 0) {
      this.logger.info('💡 Suggested recovery actions:');
      error.recoveryActions.forEach((action, index) => {
        this.logger.info(`   ${index + 1}. ${action}`);
      });
    }
  }

  private getExitCode(errorCode: ErrorCode): number {
    switch (errorCode) {
      case ErrorCode.SYSTEM_REQUIREMENTS_NOT_MET:
      case ErrorCode.INVALID_CONFIG:
      case ErrorCode.CONFIG_NOT_FOUND:
        return 1; // Configuration/setup errors

      case ErrorCode.FILE_PERMISSION_DENIED:
      case ErrorCode.FILE_NOT_ACCESSIBLE:
        return 2; // Permission/access errors

      case ErrorCode.DATABASE_CONNECTION_FAILED:
      case ErrorCode.DATABASE_CORRUPTION:
        return 3; // Database errors

      case ErrorCode.PARSING_FAILED:
      case ErrorCode.TYPESCRIPT_CONFIG_ERROR:
      case ErrorCode.ANALYSIS_FAILED:
        return 4; // Analysis errors

      case ErrorCode.INSUFFICIENT_MEMORY:
      case ErrorCode.ANALYSIS_TIMEOUT:
        return 5; // Resource errors

      case ErrorCode.OPERATION_CANCELLED:
        return 130; // User cancellation (SIGINT)

      default:
        return 1; // Generic error
    }
  }

  async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    errorCode: ErrorCode
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.options.maxRetries) {
          this.logger.warn(
            `${operationName} failed (attempt ${attempt}/${this.options.maxRetries}). Retrying in ${this.options.retryDelay}ms...`
          );
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
        }
      }
    }

    // All retries exhausted
    const funcqcError = this.createError(
      errorCode,
      `${operationName} failed after ${this.options.maxRetries} attempts`,
      { attempts: this.options.maxRetries },
      lastError
    );

    this.handleError(funcqcError);
  }

  wrapAsync<T extends unknown[], R>(
    fn: (...args: T) => Promise<R>,
    operationName: string,
    errorCode: ErrorCode
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        const funcqcError = this.createError(
          errorCode,
          `${operationName} failed: ${error instanceof Error ? error.message : String(error)}`,
          { arguments: args },
          error instanceof Error ? error : undefined
        );
        this.handleError(funcqcError);
      }
    };
  }

  safeOperation<T>(
    operation: () => T,
    operationName: string,
    _errorCode: ErrorCode,
    fallback?: T
  ): T | undefined {
    try {
      return operation();
    } catch (error) {
      this.logger.warn(
        `${operationName} failed: ${error instanceof Error ? error.message : String(error)}`
      );

      if (fallback !== undefined) {
        this.logger.info(`Using fallback value for ${operationName}`);
        return fallback;
      }

      return undefined;
    }
  }
}

// Convenience function for creating a global error handler
export function createErrorHandler(logger: Logger): ErrorHandler {
  return new ErrorHandler(logger);
}

// Process-level error handlers
export function setupGlobalErrorHandlers(errorHandler: ErrorHandler): void {
  process.on('uncaughtException', error => {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      'Uncaught exception',
      {},
      error
    );
    errorHandler.handleError(funcqcError);
  });

  process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      'Unhandled promise rejection',
      { promise: promise.toString() },
      error
    );
    errorHandler.handleError(funcqcError);
  });

  process.on('SIGINT', () => {
    const funcqcError = errorHandler.createError(
      ErrorCode.OPERATION_CANCELLED,
      'Operation cancelled by user',
      {}
    );
    errorHandler.handleError(funcqcError);
  });
}
