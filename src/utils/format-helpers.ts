/**
 * JSON output utilities optimized for jq/script processing
 * Focus on stable, parse-friendly JSON output
 */

/**
 * Options interface for JSON output
 */
interface JsonOptions {
  json?: boolean;
}

/**
 * Checks if output should be in JSON format
 */
export function isJsonOutput(options: JsonOptions): boolean {
  return Boolean(options.json);
}

/**
 * Creates stable JSON output with sorted keys for consistent jq processing
 * Implements schema versioning and stable key ordering
 */
export function createStableJsonOutput<T extends Record<string, unknown>>(
  data: T,
  schemaVersion = '1.0'
): string {
  // Add schema version for future compatibility
  const outputData = {
    schema_version: schemaVersion,
    ...data
  };

  // Recursively sort keys for stable output
  const sortKeys = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }
    const record = obj as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce((sorted: Record<string, unknown>, key) => {
        sorted[key] = sortKeys(record[key]);
        return sorted;
      }, {});
  };

  return JSON.stringify(sortKeys(outputData), null, 2);
}

/**
 * Sanitize data for JSON output (convert undefined to null, ensure number types)
 */
export function sanitizeForJson<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as T;
  }
  
  if (Array.isArray(data)) {
    return data.map(sanitizeForJson) as T;
  }
  
  if (typeof data === 'object') {
    const sanitized = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeForJson(value);
    }
    return sanitized as T;
  }
  
  return data;
}

/**
 * Safe console output that respects JSON mode
 * Outputs to stderr when in JSON mode to keep stdout clean for piping
 */
export function safeLog(message: string, options: JsonOptions): void {
  if (isJsonOutput(options)) {
    // In JSON mode, log to stderr to keep stdout clean for jq
    console.error(message);
  } else {
    // Normal console output for human-readable mode
    console.log(message);
  }
}

/**
 * Output JSON with proper stdout/stderr separation
 */
export function outputJson<T extends Record<string, unknown>>(
  data: T,
  options: JsonOptions,
  schemaVersion = '1.0'
): void {
  if (isJsonOutput(options)) {
    const sanitizedData = sanitizeForJson(data);
    const stableJson = createStableJsonOutput(sanitizedData, schemaVersion);
    console.log(stableJson);
  }
}

/**
 * Conditional console output that respects JSON mode
 */
export function conditionalLog(message: string, options: JsonOptions): void {
  if (!isJsonOutput(options)) {
    console.log(message);
  }
}

/**
 * Error output that always goes to stderr
 */
export function errorLog(message: string): void {
  console.error(message);
}