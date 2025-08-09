/**
 * JSON Helper utilities for safe parsing of database JSONB fields
 */

/**
 * Safely parses a value that might be a JSON string or already an object.
 * Handles the case where PGLite automatically parses JSONB fields.
 * 
 * @param value The value to parse (might be string or already parsed object)
 * @param fallbackValue The value to return if parsing fails (defaults to empty array)
 * @returns The parsed object, original object if not a string, or fallback value
 */
export function safeJsonParse<T>(value: unknown, fallbackValue: T = [] as unknown as T): T {
  // 1. If the value is not a string, it's likely already parsed by PGLite
  if (typeof value !== 'string') {
    return (value as T) ?? fallbackValue;
  }

  // 2. If it's an empty string, return the fallback
  if (value === '') {
    return fallbackValue;
  }

  // 3. If it is a string, try to parse it
  try {
    return JSON.parse(value) as T;
  } catch {
    // 4. Silently return fallback to avoid console spam
    // The original error was logged too frequently
    return fallbackValue;
  }
}

/**
 * Helper to safely parse JSON with custom error handling
 * Use this variant when you need to log specific parsing failures
 */
export function safeJsonParseWithLogging<T>(
  value: unknown,
  fallbackValue: T,
  context?: string
): T {
  if (typeof value !== 'string') {
    return (value as T) ?? fallbackValue;
  }

  if (value === '') {
    return fallbackValue;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn(
      `⚠️  JSON parse failed${context ? ` in ${context}` : ''}: "${value}". Using fallback.`
    );
    return fallbackValue;
  }
}