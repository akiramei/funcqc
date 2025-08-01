import * as path from 'path';

/**
 * Path utility functions for consistent path handling across the codebase
 */

/**
 * Extract relative path from absolute file path
 * Provides consistent path normalization for all components
 */
export function getRelativePath(filePath: string): string {
  try {
    const cwd = process.cwd();
    return path.relative(cwd, filePath);
  } catch {
    return path.basename(filePath);
  }
}