/**
 * Batch File Reader
 * 
 * Optimizes file I/O by batching reads and handling errors gracefully.
 * Eliminates duplicate existence checks by using direct file reading.
 */

import * as fs from 'fs/promises';
import { Stats } from 'fs';
// import * as path from 'path'; // Not used in current implementation

export interface FileReadResult {
  filePath: string;
  content?: string;
  error?: Error;
  exists: boolean;
  size: number;
  modifiedTime: Date;
}

export interface BatchReadOptions {
  concurrency?: number;
  encoding?: BufferEncoding;
  maxFileSize?: number; // in bytes, default 10MB
  timeout?: number; // per file timeout in ms
}

export class BatchFileReader {
  private concurrency: number;
  private encoding: BufferEncoding;
  private maxFileSize: number;
  private timeout: number;

  constructor(options: BatchReadOptions = {}) {
    this.concurrency = options.concurrency || 10;
    this.encoding = options.encoding || 'utf-8';
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.timeout = options.timeout || 30000; // 30 seconds
  }

  /**
   * Read multiple files in batches with optimized I/O
   */
  async readFiles(filePaths: string[]): Promise<Map<string, FileReadResult>> {
    const results = new Map<string, FileReadResult>();
    
    // Process files in concurrent batches
    for (let i = 0; i < filePaths.length; i += this.concurrency) {
      const batch = filePaths.slice(i, i + this.concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(filePath => this.readSingleFile(filePath))
      );
      
      // Process batch results
      for (let j = 0; j < batchResults.length; j++) {
        const filePath = batch[j];
        const result = batchResults[j];
        
        if (result.status === 'fulfilled') {
          results.set(filePath, result.value);
        } else {
          results.set(filePath, {
            filePath,
            exists: false,
            error: result.reason,
            size: 0,
            modifiedTime: new Date(0)
          });
        }
      }
    }
    
    return results;
  }

  /**
   * Read single file with comprehensive error handling
   */
  private async readSingleFile(filePath: string): Promise<FileReadResult> {
    return new Promise(async (resolve, reject) => {
      // Set timeout for individual file read
      const timeoutId = setTimeout(() => {
        reject(new Error(`File read timeout after ${this.timeout}ms: ${filePath}`));
      }, this.timeout);

      try {
        // Get file stats and content in parallel
        const [stats, content] = await Promise.all([
          fs.stat(filePath),
          fs.readFile(filePath, this.encoding)
        ]);

        clearTimeout(timeoutId);

        // Check file size limit
        if (stats.size > this.maxFileSize) {
          resolve({
            filePath,
            exists: true,
            error: new Error(`File too large: ${stats.size} bytes (limit: ${this.maxFileSize})`),
            size: stats.size,
            modifiedTime: stats.mtime
          });
          return;
        }

        resolve({
          filePath,
          content,
          exists: true,
          size: stats.size,
          modifiedTime: stats.mtime
        });

      } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && 'code' in error) {
          const code = (error as NodeJS.ErrnoException).code;
          
          if (code === 'ENOENT') {
            // File doesn't exist
            resolve({
              filePath,
              exists: false,
              error,
              size: 0,
              modifiedTime: new Date(0)
            });
            return;
          }
          
          if (code === 'EACCES' || code === 'EPERM') {
            // Permission denied
            resolve({
              filePath,
              exists: true,
              error: new Error(`Permission denied: ${filePath}`),
              size: 0,
              modifiedTime: new Date(0)
            });
            return;
          }
        }
        
        // Other errors
        reject(error);
      }
    });
  }

  /**
   * Filter existing files without reading content
   */
  async filterExistingFiles(filePaths: string[]): Promise<string[]> {
    const existingFiles: string[] = [];
    
    // Check files in batches
    for (let i = 0; i < filePaths.length; i += this.concurrency) {
      const batch = filePaths.slice(i, i + this.concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async filePath => {
          try {
            await fs.access(filePath, fs.constants.F_OK);
            return { filePath, exists: true };
          } catch {
            return { filePath, exists: false };
          }
        })
      );
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.exists) {
          existingFiles.push(result.value.filePath);
        }
      }
    }
    
    return existingFiles;
  }

  /**
   * Get file stats in batch
   */
  async getFileStats(filePaths: string[]): Promise<Map<string, Stats | null>> {
    const stats = new Map<string, Stats | null>();
    
    for (let i = 0; i < filePaths.length; i += this.concurrency) {
      const batch = filePaths.slice(i, i + this.concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(filePath => fs.stat(filePath))
      );
      
      for (let j = 0; j < batchResults.length; j++) {
        const filePath = batch[j];
        const result = batchResults[j];
        
        stats.set(
          filePath,
          result.status === 'fulfilled' ? result.value : null
        );
      }
    }
    
    return stats;
  }

  /**
   * Read files with change detection (compare modification times)
   */
  async readFilesWithChangeDetection(
    filePaths: string[],
    lastModifiedTimes: Map<string, Date>
  ): Promise<{
    changed: Map<string, FileReadResult>;
    unchanged: string[];
  }> {
    const changed = new Map<string, FileReadResult>();
    const unchanged: string[] = [];
    
    // First, check modification times
    const stats = await this.getFileStats(filePaths);
    const filesToRead: string[] = [];
    
    for (const filePath of filePaths) {
      const stat = stats.get(filePath);
      const lastModified = lastModifiedTimes.get(filePath);
      
      if (!stat) {
        // File doesn't exist or error getting stats
        changed.set(filePath, {
          filePath,
          exists: false,
          size: 0,
          modifiedTime: new Date(0)
        });
      } else if (!lastModified || stat.mtime > lastModified) {
        // File is new or modified
        filesToRead.push(filePath);
      } else {
        // File unchanged
        unchanged.push(filePath);
      }
    }
    
    // Read only changed files
    if (filesToRead.length > 0) {
      const readResults = await this.readFiles(filesToRead);
      for (const [filePath, result] of readResults) {
        changed.set(filePath, result);
      }
    }
    
    return { changed, unchanged };
  }
}