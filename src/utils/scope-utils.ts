import { minimatch } from 'minimatch';
import * as path from 'path';
import { ScopeConfig } from '../types';

/**
 * Scope path patterns for filtering
 */
export interface ScopePathPatterns {
  include: string[];
  exclude: string[];
  roots: string[];
}

/**
 * Get path patterns from scope configuration
 */
export function getScopePathPatterns(scopeConfig: ScopeConfig): ScopePathPatterns {
  const roots = scopeConfig.roots ?? [];
  const exclude = scopeConfig.exclude ?? [];
  const include = scopeConfig.include ?? [];

  return {
    roots,
    exclude,
    include,
  };
}

/**
 * Check if a file path is included in the given scope
 */
export function isPathInScope(filePath: string, scopeConfig: ScopeConfig): boolean {
  const patterns = getScopePathPatterns(scopeConfig);
  
  // Normalize path for comparison
  const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');
  
  // Check if the path is within any of the scope roots
  const isInRoots = patterns.roots.some(root => {
    const normalizedRoot = path.normalize(root).replace(/\\/g, '/');
    return normalizedPath.startsWith(normalizedRoot + '/') || normalizedPath === normalizedRoot;
  });
  
  if (!isInRoots) {
    return false;
  }
  
  // If scope has specific include patterns, check if file matches any of them
  if (patterns.include.length > 0) {
    const matchesInclude = patterns.include.some(pattern => minimatch(normalizedPath, pattern));
    if (!matchesInclude) {
      return false;
    }
  }
  
  // Check if file matches any exclude pattern
  const matchesExclude = patterns.exclude.some(pattern => minimatch(normalizedPath, pattern));
  if (matchesExclude) {
    return false;
  }
  
  return true;
}

/**
 * Generate SQL WHERE clause for scope-based file path filtering
 */
export function buildScopeWhereClause(
  scopeConfig: ScopeConfig,
  filePathColumn: string,
  paramIndex: number
): { whereClause: string; params: string[] } {
  const patterns = getScopePathPatterns(scopeConfig);
  const params: string[] = [];
  const conditions: string[] = [];
  
  // Add roots condition - file path should start with one of the roots
  if (patterns.roots.length > 0) {
    const rootConditions = patterns.roots.map((root) => {
      params.push(`${root}/%`);
      return `${filePathColumn} LIKE $${paramIndex + params.length}`;
    });
    
    // Also check for exact match to root path
    const exactRootConditions = patterns.roots.map((root) => {
      params.push(root);
      return `${filePathColumn} = $${paramIndex + params.length}`;
    });
    
    conditions.push(`(${rootConditions.concat(exactRootConditions).join(' OR ')})`);
  }
  
  // Add exclude conditions
  if (patterns.exclude.length > 0) {
    const excludeConditions = patterns.exclude.map(pattern => {
      // Convert glob pattern to SQL LIKE pattern
      const likePattern = pattern.replace(/\*\*/g, '%').replace(/\*/g, '%');
      params.push(likePattern);
      return `${filePathColumn} NOT LIKE $${paramIndex + params.length}`;
    });
    conditions.push(`(${excludeConditions.join(' AND ')})`);
  }
  
  // Add include conditions (if specified)
  if (patterns.include.length > 0) {
    const includeConditions = patterns.include.map(pattern => {
      // Convert glob pattern to SQL LIKE pattern
      const likePattern = pattern.replace(/\*\*/g, '%').replace(/\*/g, '%');
      params.push(likePattern);
      return `${filePathColumn} LIKE $${paramIndex + params.length}`;
    });
    conditions.push(`(${includeConditions.join(' OR ')})`);
  }
  
  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
  
  return {
    whereClause,
    params,
  };
}

/**
 * Check if a file path matches any of the given glob patterns
 */
export function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  
  const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');
  return patterns.some(pattern => minimatch(normalizedPath, pattern));
}

/**
 * Get all file paths that belong to a specific scope from a list of file paths
 */
export function filterPathsByScope(filePaths: string[], scopeConfig: ScopeConfig): string[] {
  return filePaths.filter(filePath => isPathInScope(filePath, scopeConfig));
}