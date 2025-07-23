import { ErrorCode } from '../../utils/error-handler';

/**
 * Database-specific error class for PGLite operations
 * Provides structured error handling with error codes and original error context
 */
export class DatabaseError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';

    // Preserve stack trace if available
    if (originalError?.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }
}

/**
 * Type guard to check if an object has a specific test tracking property
 */
export function hasTestTrackingProperty(obj: unknown, property: string): obj is Record<string, unknown> {
  return obj !== null && 
         typeof obj === 'object' && 
         property in obj;
}

/**
 * Type guard to check if a value is a test tracking function
 */
export function isTestTrackingFunction(value: unknown): value is (connection: { close(): Promise<void> }) => void {
  return typeof value === 'function';
}