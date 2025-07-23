/**
 * Utility operations module for PGLite storage
 * Contains helper functions and common utilities
 */

import { StorageContext, StorageOperationModule } from './types';

export class UtilityOperations implements StorageOperationModule {
  readonly db;
  readonly kysely;
  private logger;

  constructor(context: StorageContext) {
    this.db = context.db;
    this.kysely = context.kysely;
    this.logger = context.logger;
  }

  /**
   * Extract source code from content based on position information
   */
  extractSourceFromContent(
    content: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number
  ): string {
    const lines = content.split('\n');

    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      throw new Error(`Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)`);
    }

    // Convert to 0-based indexing
    const startLineIndex = startLine - 1;
    const endLineIndex = endLine - 1;

    // Handle case where column information is not available (both are 0)
    // In this case, extract complete lines
    if (startColumn === 0 && endColumn === 0) {
      const result: string[] = [];
      for (let i = startLineIndex; i <= endLineIndex; i++) {
        if (i < lines.length) {
          result.push(lines[i]);
        }
      }
      return result.join('\n');
    }

    if (startLineIndex === endLineIndex) {
      // Single line function
      const line = lines[startLineIndex];
      // Column positions are likely 1-based, convert to 0-based for substring
      const startCol = Math.max(0, startColumn - 1);
      const endCol = endColumn > 0 ? endColumn - 1 : line.length;
      return line.substring(startCol, endCol);
    }

    // Multi-line function
    const result: string[] = [];

    // First line (from startColumn to end of line)
    // Column positions are likely 1-based, convert to 0-based for substring
    const startCol = Math.max(0, startColumn - 1);
    result.push(lines[startLineIndex].substring(startCol));

    // Middle lines (complete lines)
    for (let i = startLineIndex + 1; i < endLineIndex; i++) {
      result.push(lines[i]);
    }

    // Last line (from beginning to endColumn)
    if (endLineIndex < lines.length) {
      const endCol = endColumn > 0 ? endColumn - 1 : lines[endLineIndex].length;
      result.push(lines[endLineIndex].substring(0, endCol));
    }

    return result.join('\n');
  }

  /**
   * Normalize file path for consistent handling
   */
  normalizeFilePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  /**
   * Generate a unique identifier
   */
  generateId(): string {
    return require('crypto').randomUUID();
  }

  /**
   * Parse JSON safely with fallback
   */
  parseJsonSafely<T>(jsonString: string, fallback: T): T {
    try {
      return JSON.parse(jsonString);
    } catch {
      return fallback;
    }
  }

  /**
   * Validate snapshot ID format
   */
  isValidSnapshotId(id: string): boolean {
    // UUID v4 format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }

  /**
   * Validate function ID format  
   */
  isValidFunctionId(id: string): boolean {
    // Check if it's a UUID or semantic ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const semanticIdRegex = /^[a-f0-9]{8,}$/; // At least 8 hex chars
    
    return uuidRegex.test(id) || semanticIdRegex.test(id);
  }

  /**
   * Escape SQL LIKE pattern special characters
   */
  escapeLikePattern(pattern: string): string {
    return pattern
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
  }

  /**
   * Build SQL IN clause with proper parameter placeholders
   */
  buildInClause(values: any[], startIndex: number = 1): { clause: string; params: any[] } {
    if (values.length === 0) {
      return { clause: 'FALSE', params: [] };
    }

    const placeholders = values.map((_, i) => `$${startIndex + i}`).join(', ');
    return {
      clause: `(${placeholders})`,
      params: values
    };
  }

  /**
   * Chunk array into smaller arrays of specified size
   */
  chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Calculate hash for content (simple implementation)
   */
  calculateContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Format file size in human readable format
   */
  formatFileSize(bytes: number): string {
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
   * Get file extension from path
   */
  getFileExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.substring(lastDot + 1).toLowerCase() : '';
  }

  /**
   * Check if file is a TypeScript/JavaScript file
   */
  isCodeFile(filePath: string): boolean {
    const ext = this.getFileExtension(filePath);
    return ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts'].includes(ext);
  }

  /**
   * Sanitize string for use in SQL queries
   */
  sanitizeString(str: string): string {
    return str.replace(/'/g, "''");
  }

  /**
   * Convert camelCase to snake_case
   */
  camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  /**
   * Convert snake_case to camelCase
   */
  snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Deep clone an object (simple implementation)
   */
  deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime()) as T;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item)) as T;
    }

    const cloned = {} as T;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }

  /**
   * Retry operation with exponential backoff
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxRetries) {
          break;
        }

        const delay = baseDelay * Math.pow(2, attempt);
        this.logger?.warn(`Operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  /**
   * Check if a value is a valid date
   */
  isValidDate(date: any): date is Date {
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Format duration in milliseconds to human readable format
   */
  formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  /**
   * Create a debounced version of a function
   */
  debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  /**
   * Throttle function execution
   */
  throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // ========================================
  // SOURCE FILE OPERATIONS
  // ========================================

  async saveSourceFiles(sourceFiles: any[], snapshotId: string): Promise<void> {
    if (sourceFiles.length === 0) return;

    const rows = sourceFiles.map(file => ({
      snapshot_id: snapshotId,
      file_path: file.filePath,
      content: file.content,
      hash: file.hash,
      size: file.size,
      function_count: file.functionCount || 0,
      created_at: new Date().toISOString()
    }));

    // Use direct SQL insertion for source files
    for (const row of rows) {
      await this.db.query(`
        INSERT INTO source_files (snapshot_id, file_path, content, hash, size, function_count, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        row.snapshot_id, row.file_path, row.content, row.hash, 
        row.size, row.function_count, row.created_at
      ]);
    }
  }

  async getSourceFile(id: string): Promise<any | null> {
    const result = await this.db.query('SELECT * FROM source_files WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as any;
    return {
      id: row.id,
      snapshotId: row.snapshot_id,
      filePath: row.file_path,
      content: row.content,
      hash: row.hash,
      size: row.size,
      functionCount: row.function_count,
      createdAt: new Date(row.created_at)
    };
  }

  async getSourceFilesBySnapshot(snapshotId: string): Promise<any[]> {
    const result = await this.db.query('SELECT * FROM source_files WHERE snapshot_id = $1', [snapshotId]);
    
    return result.rows.map(row => {
      const r = row as any;
      return {
        id: r.id,
        snapshotId: r.snapshot_id,
        filePath: r.file_path,
        content: r.content,
        hash: r.hash,
        size: r.size,
        functionCount: r.function_count,
        createdAt: new Date(r.created_at)
      };
    });
  }

  async getSourceFileByPath(filePath: string, snapshotId: string): Promise<any | null> {
    const result = await this.db.query('SELECT * FROM source_files WHERE file_path = $1 AND snapshot_id = $2', [filePath, snapshotId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as any;
    return {
      id: row.id,
      snapshotId: row.snapshot_id,
      filePath: row.file_path,
      content: row.content,
      hash: row.hash,
      size: row.size,
      functionCount: row.function_count,
      createdAt: new Date(row.created_at)
    };
  }

  async findExistingSourceFile(_compositeId: string): Promise<string | null> {
    // This is a stub - actual implementation would depend on how composite IDs are structured
    return null;
  }

  async deleteSourceFiles(snapshotId: string): Promise<number> {
    await this.db.query('DELETE FROM source_files WHERE snapshot_id = $1', [snapshotId]);
    
    // Return 0 for now since PGLite doesn't return affected rows count easily
    return 0;
  }

  async updateSourceFileFunctionCounts(functionCountByFile: Map<string, number>, snapshotId: string): Promise<void> {
    for (const [filePath, count] of functionCountByFile.entries()) {
      await this.db.query(`
        UPDATE source_files 
        SET function_count = $1 
        WHERE file_path = $2 AND snapshot_id = $3
      `, [count, filePath, snapshotId]);
    }
  }

  // ========================================
  // UTILITY OPERATIONS
  // ========================================

  async cleanup(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    // Clean up old snapshots and their related data
    await this.db.query('DELETE FROM snapshots WHERE created_at < $1', [cutoffDate.toISOString()]);
    
    // Return 0 for now since PGLite doesn't return affected rows count easily
    return 0;
  }

  async backup(_options: any): Promise<string> {
    // This is a stub - actual implementation would export the database
    return JSON.stringify({ message: 'Backup not implemented' });
  }

  async restore(_backupData: string): Promise<void> {
    // This is a stub - actual implementation would restore the database
    return;
  }
}