import * as path from 'path';

/**
 * Normalize a file path for consistent comparison
 * 
 * @param filePath - The file path to normalize
 * @returns Normalized file path (absolute, lowercase, forward slashes)
 */
export function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath)).toLowerCase().replace(/\\/g, '/');
}

/**
 * Compare two file paths for equality with normalization
 * 
 * @param path1 - First file path
 * @param path2 - Second file path  
 * @returns True if paths refer to the same file
 */
export function arePathsEqual(path1: string, path2: string): boolean {
  return normalizePath(path1) === normalizePath(path2);
}

/**
 * Filter functions by file path with normalization
 * 
 * @param functions - Array of objects with filePath property
 * @param targetPath - Target file path to match
 * @returns Filtered array of functions matching the target path
 */
export function filterByPath<T extends { filePath: string }>(functions: T[], targetPath: string): T[] {
  const normalizedTarget = normalizePath(targetPath);
  return functions.filter(func => normalizePath(func.filePath) === normalizedTarget);
}

/**
 * Create a Map grouping functions by normalized file path
 * 
 * @param functions - Array of objects with filePath property
 * @returns Map from normalized file path to array of functions
 */
export function groupByPath<T extends { filePath: string }>(functions: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  
  for (const func of functions) {
    const normalizedPath = normalizePath(func.filePath);
    const existing = groups.get(normalizedPath) || [];
    existing.push(func);
    groups.set(normalizedPath, existing);
  }
  
  return groups;
}

/**
 * Convert arbitrary path to unified project-root path used across analyzers: '/src/...'
 * - Converts to POSIX separators
 * - Ensures a leading slash
 * - Preserves existing leading slash if present
 */
export function toUnifiedProjectPath(filePath: string): string {
  if (!filePath) return '';
  const posix = filePath.replace(/\\/g, '/');
  // 既に統一済み（仮想プロジェクトパス）
  if (posix.startsWith('/src/')) return posix;
  const cwdPosix = process.cwd().replace(/\\/g, '/');
  let rel = posix;
  // 絶対パス（POSIX/Windows）なら CWD 基準に相対へ
  if (/^[A-Za-z]:\//.test(posix) || posix.startsWith('/')) {
    if (posix.startsWith(cwdPosix + '/')) {
      rel = posix.slice(cwdPosix.length + 1);
    } else {
      rel = path.posix.relative(cwdPosix, posix);
    }
  }
  // 先頭の './' を除去
  rel = rel.replace(/^\.\/+/, '');
  return `/${rel}`;
}

/**
 * @deprecated Use individual exported functions instead
 * Utility object for backward compatibility with class-based interface
 */
export const PathNormalizer = {
  normalize: normalizePath,
  areEqual: arePathsEqual,
  filterByPath,
  groupByPath,
  toUnified: toUnifiedProjectPath,
};
