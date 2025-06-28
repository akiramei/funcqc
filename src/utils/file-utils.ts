import * as fs from 'fs/promises';
import * as path from 'path';
import { minimatch } from 'minimatch';

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory might already exist
    if ((error as any).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Find files recursively in a directory with optional filtering
 */
export async function findFiles(
  dir: string,
  options: {
    extensions?: string[];
    exclude?: string[];
    maxDepth?: number;
  } = {}
): Promise<string[]> {
  const { extensions, exclude = [], maxDepth = 10 } = options;
  const files: string[] = [];

  async function walk(currentDir: string, depth: number = 0): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        // Check exclude patterns
        if (shouldExclude(fullPath, exclude)) {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Check file extension
          if (!extensions || extensions.some(ext => fullPath.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Skip inaccessible directories
      console.warn(`Warning: Cannot access ${currentDir}`);
    }
  }

  await walk(dir);
  return files;
}

/**
 * Check if a file path should be excluded based on patterns
 */
export function shouldExclude(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const pattern of patterns) {
    if (minimatch(normalizedPath, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format duration in human readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }

  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

/**
 * Debounce function execution
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): T {
  let timeoutId: NodeJS.Timeout;
  
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  }) as T;
}

/**
 * Throttle function execution
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): T {
  let lastCall = 0;
  
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func(...args);
    }
  }) as T;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    factor?: number;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    factor = 2
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        throw lastError;
      }

      const delay = Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Calculate percentage with safe division
 */
export function percentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100 * 100) / 100; // Round to 2 decimal places
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Generate a simple hash from string
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Deep merge objects using simple JSON approach
 */
export function deepMerge<T extends Record<string, any>>(target: T, ...sources: Partial<T>[]): T {
  const result = JSON.parse(JSON.stringify(target)) as T;
  
  for (const source of sources) {
    if (source) {
      Object.assign(result, JSON.parse(JSON.stringify(source)));
    }
  }
  
  return result;
}

/**
 * Parse numeric condition string (e.g., ">5", "3..10", "1,2,3")
 */
export function parseNumericCondition(condition: string): {
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'BETWEEN' | 'IN';
  value: number | number[];
} | null {
  condition = condition.trim();

  // Range: "5..10"
  const rangeResult = parseRangeCondition(condition);
  if (rangeResult) return rangeResult;

  // Multiple values: "1,2,3"
  const inResult = parseInCondition(condition);
  if (inResult) return inResult;

  // Comparison operators
  const comparisonResult = parseComparisonCondition(condition);
  if (comparisonResult) return comparisonResult;

  // Exact match
  return parseExactCondition(condition);
}

function parseRangeCondition(condition: string) {
  if (!condition.includes('..')) return null;
  
  const [min, max] = condition.split('..').map(Number);
  if (!isNaN(min) && !isNaN(max)) {
    return { operator: 'BETWEEN' as const, value: [min, max] };
  }
  return null;
}

function parseInCondition(condition: string) {
  if (!condition.includes(',')) return null;
  
  const values = condition.split(',').map(Number).filter(n => !isNaN(n));
  if (values.length > 0) {
    return { operator: 'IN' as const, value: values };
  }
  return null;
}

function parseComparisonCondition(condition: string) {
  const operators = [
    { prefix: '>=', operator: '>=' as const, length: 2 },
    { prefix: '<=', operator: '<=' as const, length: 2 },
    { prefix: '!=', operator: '!=' as const, length: 2 },
    { prefix: '<>', operator: '!=' as const, length: 2 },
    { prefix: '>', operator: '>' as const, length: 1 },
    { prefix: '<', operator: '<' as const, length: 1 }
  ];

  for (const { prefix, operator, length } of operators) {
    if (condition.startsWith(prefix)) {
      const value = Number(condition.slice(length));
      if (!isNaN(value)) {
        return { operator, value };
      }
    }
  }
  return null;
}

function parseExactCondition(condition: string) {
  const value = Number(condition);
  if (!isNaN(value)) {
    return { operator: '=' as const, value };
  }
  return null;
}
