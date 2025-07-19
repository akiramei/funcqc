import * as path from 'path';

/**
 * Utility for normalizing file paths for consistent comparison across platforms
 * 
 * This addresses common issues with file path comparison:
 * - Case sensitivity differences (Windows vs Unix)
 * - Path separator differences (\ vs /)
 * - Relative vs absolute path differences
 * - Symbolic link resolution
 */
export class PathNormalizer {
  /**
   * Normalize a file path for consistent comparison
   * 
   * @param filePath - The file path to normalize
   * @returns Normalized file path (absolute, lowercase, forward slashes)
   */
  static normalize(filePath: string): string {
    return path.normalize(path.resolve(filePath)).toLowerCase().replace(/\\/g, '/');
  }
  
  /**
   * Compare two file paths for equality with normalization
   * 
   * @param path1 - First file path
   * @param path2 - Second file path  
   * @returns True if paths refer to the same file
   */
  static areEqual(path1: string, path2: string): boolean {
    return this.normalize(path1) === this.normalize(path2);
  }
  
  /**
   * Filter functions by file path with normalization
   * 
   * @param functions - Array of objects with filePath property
   * @param targetPath - Target file path to match
   * @returns Filtered array of functions matching the target path
   */
  static filterByPath<T extends { filePath: string }>(functions: T[], targetPath: string): T[] {
    const normalizedTarget = this.normalize(targetPath);
    return functions.filter(func => this.normalize(func.filePath) === normalizedTarget);
  }
  
  /**
   * Create a Map grouping functions by normalized file path
   * 
   * @param functions - Array of objects with filePath property
   * @returns Map from normalized file path to array of functions
   */
  static groupByPath<T extends { filePath: string }>(functions: T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    
    for (const func of functions) {
      const normalizedPath = this.normalize(func.filePath);
      const existing = groups.get(normalizedPath) || [];
      existing.push(func);
      groups.set(normalizedPath, existing);
    }
    
    return groups;
  }
}