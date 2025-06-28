import { Logger } from './cli-utils';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import * as os from 'os';

export interface ResourceLimits {
  maxMemoryMB: number;
  maxFileSize: number;
  maxFilesPerBatch: number;
  streamingThreshold: number;
}

export interface MemoryInfo {
  heapUsed: number;
  heapTotal: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rss: number;
  rssMB: number;
}

export class ResourceManager {
  private logger: Logger;
  private limits: ResourceLimits;
  private gcForced: boolean = false;

  constructor(logger: Logger, limits: Partial<ResourceLimits> = {}) {
    this.logger = logger;
    this.limits = {
      maxMemoryMB: 512, // 512MB default limit
      maxFileSize: 5 * 1024 * 1024, // 5MB
      maxFilesPerBatch: 50,
      streamingThreshold: 1024 * 1024, // 1MB
      ...limits
    };
  }

  getMemoryInfo(): MemoryInfo {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: memUsage.rss,
      rssMB: Math.round(memUsage.rss / 1024 / 1024)
    };
  }

  checkMemoryUsage(): boolean {
    const memInfo = this.getMemoryInfo();
    
    if (memInfo.heapUsedMB > this.limits.maxMemoryMB) {
      this.logger.warn(`Memory usage (${memInfo.heapUsedMB}MB) exceeds limit (${this.limits.maxMemoryMB}MB)`);
      return false;
    }

    // Warning at 80% of limit
    const warningThreshold = this.limits.maxMemoryMB * 0.8;
    if (memInfo.heapUsedMB > warningThreshold) {
      this.logger.warn(`Memory usage (${memInfo.heapUsedMB}MB) approaching limit (${this.limits.maxMemoryMB}MB)`);
    }

    return true;
  }

  async forceGarbageCollection(): Promise<void> {
    if (global.gc) {
      this.logger.debug('Forcing garbage collection...');
      global.gc();
      this.gcForced = true;
      
      // Log memory info after GC
      const memInfo = this.getMemoryInfo();
      this.logger.debug(`Memory after GC: ${memInfo.heapUsedMB}MB used, ${memInfo.heapTotalMB}MB total`);
    } else {
      this.logger.debug('Garbage collection not available (run with --expose-gc to enable)');
    }
  }

  async manageMemory(): Promise<void> {
    const memInfo = this.getMemoryInfo();
    
    // Force GC if using more than 70% of limit
    const gcThreshold = this.limits.maxMemoryMB * 0.7;
    if (memInfo.heapUsedMB > gcThreshold && !this.gcForced) {
      await this.forceGarbageCollection();
      this.gcForced = false; // Reset flag
    }
  }

  async checkFileSize(filePath: string): Promise<boolean> {
    try {
      const stats = await stat(filePath);
      
      if (stats.size > this.limits.maxFileSize) {
        this.logger.warn(`File ${filePath} (${this.formatBytes(stats.size)}) exceeds size limit (${this.formatBytes(this.limits.maxFileSize)})`);
        return false;
      }
      
      return true;
    } catch (error) {
      this.logger.warn(`Cannot check file size for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  shouldUseStreaming(filePath: string): Promise<boolean> {
    return this.checkFileSize(filePath).then(async (withinLimit) => {
      if (!withinLimit) return true; // Use streaming for large files
      
      try {
        const stats = await stat(filePath);
        return stats.size > this.limits.streamingThreshold;
      } catch {
        return false;
      }
    });
  }

  createBatches<T>(items: T[], customBatchSize?: number): T[][] {
    const batchSize = customBatchSize || this.limits.maxFilesPerBatch;
    const batches: T[][] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    
    return batches;
  }

  async *processInBatches<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    onProgress?: (processed: number, total: number) => void
  ): AsyncGenerator<R[], void, unknown> {
    const batches = this.createBatches(items);
    let processed = 0;
    
    for (const batch of batches) {
      // Check memory before processing each batch
      await this.manageMemory();
      
      if (!this.checkMemoryUsage()) {
        throw new Error(`Memory limit exceeded. Consider reducing batch size or increasing memory limit.`);
      }
      
      const results = await processor(batch);
      processed += batch.length;
      
      if (onProgress) {
        onProgress(processed, items.length);
      }
      
      yield results;
    }
  }

  async createStreamingReader(filePath: string): Promise<NodeJS.ReadableStream> {
    const useStreaming = await this.shouldUseStreaming(filePath);
    
    if (useStreaming) {
      this.logger.debug(`Using streaming reader for ${filePath}`);
      return createReadStream(filePath, { encoding: 'utf8' });
    } else {
      // For small files, we could return a different type of stream or fallback
      this.logger.debug(`Using regular file read for ${filePath}`);
      return createReadStream(filePath, { encoding: 'utf8' });
    }
  }

  setupMemoryMonitoring(intervalMs: number = 30000): NodeJS.Timeout {
    return setInterval(() => {
      const memInfo = this.getMemoryInfo();
      this.logger.debug(`Memory monitoring: ${memInfo.heapUsedMB}MB used, ${memInfo.rssMB}MB RSS`);
      
      if (!this.checkMemoryUsage()) {
        this.logger.warn('Memory limit exceeded during monitoring');
      }
    }, intervalMs);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  logResourceSummary(): void {
    const memInfo = this.getMemoryInfo();
    
    this.logger.info('📊 Resource Summary:');
    this.logger.info(`   Memory: ${memInfo.heapUsedMB}MB used / ${this.limits.maxMemoryMB}MB limit`);
    this.logger.info(`   File size limit: ${this.formatBytes(this.limits.maxFileSize)}`);
    this.logger.info(`   Batch size: ${this.limits.maxFilesPerBatch} files`);
    this.logger.info(`   Streaming threshold: ${this.formatBytes(this.limits.streamingThreshold)}`);
  }

  // Static helper to get system memory info
  static getSystemMemoryInfo(): { totalMB: number; freeMB: number } | null {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      return {
        totalMB: Math.round(totalMem / 1024 / 1024),
        freeMB: Math.round(freeMem / 1024 / 1024)
      };
    } catch {
      return null;
    }
  }
}